from __future__ import annotations

from hashlib import sha256
import json
import math
import os
from pathlib import Path
import secrets
import stat
import subprocess
import threading
import time
from typing import Any

from memory_modules.memory import Memory, MemoryContextItem, register_memory


DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b"
MANIFEST_VERSION = "megasaver-lm2-manifest-v1"
CONTROL_NAME = "megasaver_lm2_control_v1.json"
CONFIG_KEYS = {
    "manifest_path", "manifest_digest", "data_revision", "cache_parent",
    "transport_command", "profile", "embedding_egress", "model", "token_budget",
    "query_timeout_ms", "index_batch_timeout_ms", "rpc_timeout_seconds",
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _canonical_value(value: Any) -> Any:
    if isinstance(value, str):
        import unicodedata
        return unicodedata.normalize("NFC", value)
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        _require(math.isfinite(value), "Non-finite benchmark value")
        if value == 0:
            return 0
        return int(value) if value.is_integer() else value
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, dict):
        _require(all(isinstance(key, str) for key in value), "Invalid benchmark object key")
        normalized = {_canonical_value(key): _canonical_value(item) for key, item in value.items()}
        _require(len(normalized) == len(value), "Normalized benchmark keys collide")
        return normalized
    raise RuntimeError("Value is not JSON-compatible")


def _canonical(value: Any) -> str:
    return json.dumps(
        _canonical_value(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True,
        allow_nan=False,
    )


def _digest(value: Any) -> str:
    return sha256(_canonical(value).encode("utf-8")).hexdigest()


def _safe_file(path: Path, maximum: int = 64 * 1024 * 1024) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise RuntimeError("Benchmark file is unavailable") from error
    try:
        info = os.fstat(descriptor)
        _require(stat.S_ISREG(info.st_mode), "Benchmark file is not regular")
        _require(stat.S_IMODE(info.st_mode) == 0o600, "Benchmark file mode is unsafe")
        if hasattr(os, "geteuid"):
            _require(info.st_uid == os.geteuid(), "Benchmark file owner mismatch")
        _require(info.st_size <= maximum, "Benchmark file is too large")
        chunks: list[bytes] = []
        remaining = info.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            _require(chunk != b"", "Benchmark file changed while reading")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _safe_dir(path: Path) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise RuntimeError("Benchmark directory is unavailable") from error
    _require(stat.S_ISDIR(info.st_mode) and not path.is_symlink(), "Unsafe benchmark directory")
    _require(stat.S_IMODE(info.st_mode) == 0o700, "Benchmark directory mode is unsafe")
    if hasattr(os, "geteuid"):
        _require(info.st_uid == os.geteuid(), "Benchmark directory owner mismatch")
    return info


@register_memory
class MegaSaverLm2HybridMemory(Memory):
    memory_type = "megasaver_lm2_hybrid"

    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        if set(memory_params) != CONFIG_KEYS:
            raise ValueError("LM2 benchmark config fields mismatch")
        string_fields = ["manifest_path", "manifest_digest", "data_revision", "cache_parent", "profile", "embedding_egress"]
        if not all(isinstance(memory_params.get(key), str) for key in string_fields):
            raise ValueError("LM2 benchmark config strings are invalid")
        if not Path(str(memory_params["manifest_path"])).is_absolute() or not Path(str(memory_params["cache_parent"])).is_absolute():
            raise ValueError("LM2 benchmark paths must be absolute")
        if not isinstance(memory_params["manifest_digest"], str) or len(memory_params["manifest_digest"]) != 64 or any(character not in "0123456789abcdef" for character in memory_params["manifest_digest"]):
            raise ValueError("LM2 benchmark manifest digest is invalid")
        if memory_params["data_revision"] != DATA_REVISION:
            raise ValueError("LM2 benchmark data revision mismatch")
        if memory_params["embedding_egress"] != "local" or memory_params["profile"] not in {"safe", "adaptive"}:
            raise ValueError("LM2 benchmark embeddings must be local")
        command = memory_params.get("transport_command")
        model = memory_params.get("model")
        if not isinstance(command, list) or not 1 <= len(command) <= 16 or not all(isinstance(part, str) and part for part in command):
            raise ValueError("LM2 benchmark transport command is invalid")
        if not isinstance(model, dict) or set(model) != {"provider", "modelId", "revision", "dimensions", "embeddingInputVersion"} or model.get("provider") != "local":
            raise ValueError("LM2 benchmark model must be local")
        integer_bounds = {"token_budget": 100_000, "query_timeout_ms": 2_000, "index_batch_timeout_ms": 15_000}
        if any(not isinstance(memory_params.get(key), int) or isinstance(memory_params.get(key), bool) or not 1 <= memory_params[key] <= bound for key, bound in integer_bounds.items()):
            raise ValueError("LM2 benchmark numeric config is invalid")
        timeout = memory_params.get("rpc_timeout_seconds")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
            raise ValueError("LM2 benchmark RPC timeout is invalid")
        self._instance_token = secrets.token_hex(16)
        self._sentinel_token: str | None = None
        self._chain: list[dict[str, str]] = []
        self._chain_digest = _digest([])
        self._lock = threading.RLock()
        self._query_metadata = threading.local()
        self._request_number = 0

    def _transport_config(self) -> dict[str, object]:
        mapping = {
            "manifestPath": "manifest_path", "manifestDigest": "manifest_digest",
            "dataRevision": "data_revision", "cacheParent": "cache_parent",
            "profile": "profile", "embeddingEgress": "embedding_egress", "model": "model",
            "tokenBudget": "token_budget", "queryTimeoutMs": "query_timeout_ms",
            "indexBatchTimeoutMs": "index_batch_timeout_ms",
        }
        return {target: self.memory_params[source] for target, source in mapping.items()}

    def _call(self, payload: dict[str, object]) -> dict[str, Any]:
        self._request_number += 1
        request_id = f"lm2-{self._request_number}"
        request = {"id": request_id, **payload}
        completed = subprocess.run(
            list(self.memory_params["transport_command"]), input=json.dumps(request, separators=(",", ":")) + "\n",
            text=True, capture_output=True, timeout=float(self.memory_params["rpc_timeout_seconds"]), check=False,
        )
        _require(completed.returncode == 0, "LM2 benchmark transport failed")
        lines = completed.stdout.splitlines()
        _require(len(lines) == 1, "LM2 benchmark transport returned invalid output")
        response = json.loads(lines[0])
        _require(isinstance(response, dict) and response.get("id") == request_id and response.get("ok") is True, "LM2 benchmark transport rejected the operation")
        result = response.get("result")
        _require(isinstance(result, dict), "LM2 benchmark transport result is invalid")
        return result

    def _ensure_open(self) -> None:
        if self._sentinel_token is not None:
            return
        result = self._call({"op": "open", "config": self._transport_config(), "instanceToken": self._instance_token})
        token = result.get("sentinelToken")
        chain_digest = result.get("chainDigest")
        _require(isinstance(token, str) and len(token) == 32 and isinstance(chain_digest, str), "LM2 open result is invalid")
        self._sentinel_token = token
        self._chain_digest = chain_digest

    def _manifest(self) -> dict[str, Any]:
        raw = _safe_file(Path(str(self.memory_params["manifest_path"])), 2 * 1024 * 1024 * 1024)
        _require(raw.endswith(b"\n") and sha256(raw[:-1]).hexdigest() == self.memory_params["manifest_digest"], "LM2 manifest digest mismatch")
        manifest = json.loads(raw)
        _require(isinstance(manifest, dict) and manifest.get("schemaVersion") == MANIFEST_VERSION, "LM2 manifest schema mismatch")
        data = manifest.get("data")
        _require(isinstance(data, dict) and data.get("revision") == DATA_REVISION, "LM2 manifest revision mismatch")
        return manifest

    def _next_trajectory(self, trajectory: dict[str, object]) -> dict[str, str] | None:
        manifest = self._manifest()
        trajectory_id = trajectory.get("id")
        if not isinstance(trajectory_id, str):
            return None
        target = {"id": trajectory_id, "fullObjectDigest": _digest(trajectory)}
        questions = manifest.get("questions")
        if not isinstance(questions, list) or not any(isinstance(row, dict) and row.get("trajectories", [])[:len(self._chain)] == self._chain and len(row.get("trajectories", [])) > len(self._chain) and row["trajectories"][len(self._chain)] == target for row in questions):
            return None
        return target

    def insert(self, trajectory: dict[str, object]) -> None:
        with self._lock:
            target = self._next_trajectory(trajectory)
            _require(target is not None, "Trajectory is not admitted by the LM2 manifest")
            self._ensure_open()
            result = self._call({"op": "insert", "config": self._transport_config(), "instanceToken": self._instance_token, "sentinelToken": self._sentinel_token, "expectedChainDigest": self._chain_digest, "trajectory": trajectory})
            _require(result.get("indexingComplete") is True and isinstance(result.get("chainDigest"), str), "LM2 insert did not finish indexing")
            self._chain.append(target)
            self._chain_digest = result["chainDigest"]

    def _admitted_question(self, query: str) -> dict[str, Any] | None:
        context = self.get_query_context()
        question_id = context.get("question_id")
        if not isinstance(question_id, str):
            return None
        questions = self._manifest().get("questions")
        if not isinstance(questions, list):
            return None
        normalized = query.strip()
        return next((row for row in questions if isinstance(row, dict) and row.get("questionId") == question_id and row.get("questionText") == normalized and row.get("questionTextDigest") == _digest(normalized) and row.get("haystackChainDigest") == self._chain_digest), None)

    def _rejected_telemetry(self, question_id: str, image_present: bool) -> dict[str, object]:
        telemetry = {"profile": self.memory_params["profile"], "semanticStatus": "rejected", "modelFingerprint": _digest(self.memory_params["model"]), "candidateCount": 0, "selectionCount": 0, "latencyMs": 0, "questionId": question_id, "questionType": "unknown", "imagePresent": image_present, "imageUsed": False}
        if self._sentinel_token is not None:
            run = Path(str(self.memory_params["cache_parent"])) / f"instance-{self._instance_token}"
            _safe_dir(run)
            _safe_dir(run / "telemetry")
            path = run / "telemetry" / "queries.jsonl"
            descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
            try:
                info = os.fstat(descriptor)
                _require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600, "LM2 telemetry file is unsafe")
                if hasattr(os, "geteuid"):
                    _require(info.st_uid == os.geteuid(), "LM2 telemetry owner mismatch")
                os.write(descriptor, (_canonical(telemetry) + "\n").encode())
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return telemetry

    def query(self, query: str, query_image: str | None = None) -> list[MemoryContextItem]:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("LM2 benchmark query must be non-empty")
        with self._lock:
            question = self._admitted_question(query)
            if question is None:
                context = self.get_query_context()
                question_id = context.get("question_id")
                self._query_metadata.value = self._rejected_telemetry(question_id if isinstance(question_id, str) else "missing", query_image is not None)
                return []
            self._ensure_open()
            result = self._call({"op": "query", "config": self._transport_config(), "instanceToken": self._instance_token, "sentinelToken": self._sentinel_token, "expectedChainDigest": self._chain_digest, "questionId": question["questionId"], "query": query.strip(), "queryImagePresent": query_image is not None})
            items = result.get("items")
            _require(isinstance(items, list), "LM2 query items are invalid")
            self._query_metadata.value = result.get("telemetry") if isinstance(result.get("telemetry"), dict) else None
            return [{"type": "text", "value": item["value"]} for item in items if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("value"), str) and item["value"].strip()]

    def post_query_hook(self, *, query: str, query_image: str | None, memory_context: list[MemoryContextItem]) -> dict[str, object] | None:
        value = getattr(self._query_metadata, "value", None)
        return dict(value) if isinstance(value, dict) else None

    def _save_backend(self, output_dir: Path) -> None:
        with self._lock:
            self._ensure_open()
            canonical_dir = output_dir.resolve(strict=True)
            info = canonical_dir.stat()
            control = {"schemaVersion": "megasaver-lm2-python-control-v1", "manifestDigest": self.memory_params["manifest_digest"], "dataRevision": DATA_REVISION, "instanceToken": self._instance_token, "sentinelToken": self._sentinel_token, "chain": self._chain, "chainDigest": self._chain_digest, "saveRealpath": str(canonical_dir), "saveDevice": str(info.st_dev), "saveInode": str(info.st_ino)}
            parent_descriptor = os.open(canonical_dir, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
            descriptor = os.open(CONTROL_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=parent_descriptor)
            try:
                os.write(descriptor, (_canonical(control) + "\n").encode())
                os.fsync(descriptor)
                os.fsync(parent_descriptor)
            finally:
                os.close(descriptor)
                os.close(parent_descriptor)

    def _load_backend(self, input_dir: Path) -> None:
        with self._lock:
            canonical_dir = input_dir.resolve(strict=True)
            info = canonical_dir.stat()
            control = json.loads(_safe_file(canonical_dir / CONTROL_NAME))
            required = {"schemaVersion", "manifestDigest", "dataRevision", "instanceToken", "sentinelToken", "chain", "chainDigest", "saveRealpath", "saveDevice", "saveInode"}
            _require(isinstance(control, dict) and set(control) == required, "LM2 saved control fields mismatch")
            _require(control["saveRealpath"] == str(canonical_dir) and control["saveDevice"] == str(info.st_dev) and control["saveInode"] == str(info.st_ino), "LM2 save directory identity mismatch")
            _require(control["manifestDigest"] == self.memory_params["manifest_digest"] and control["dataRevision"] == DATA_REVISION and control["chainDigest"] == _digest(control["chain"]), "LM2 saved control binding mismatch")
            run = Path(str(self.memory_params["cache_parent"])) / f"instance-{control['instanceToken']}"
            _safe_dir(run)
            sentinel = json.loads(_safe_file(run / "sentinel.json"))
            _require(sentinel.get("instanceToken") == control["instanceToken"] and sentinel.get("sentinelToken") == control["sentinelToken"] and sentinel.get("manifestDigest") == control["manifestDigest"], "LM2 run sentinel mismatch")
            self._manifest()
            self._instance_token = control["instanceToken"]
            self._sentinel_token = control["sentinelToken"]
            self._chain = control["chain"]
            self._chain_digest = control["chainDigest"]
