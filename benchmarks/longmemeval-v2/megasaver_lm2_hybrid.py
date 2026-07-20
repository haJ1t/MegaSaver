from __future__ import annotations
from datetime import datetime, timezone
from hashlib import sha256
import fcntl, json, math, os, re, secrets, stat, subprocess, threading, unicodedata
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5
from memory_modules.memory import Memory, MemoryContextItem, register_memory
DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b"
MANIFEST_VERSION = "megasaver-lm2-manifest-v1"
OFFICIAL_COMMIT = "6f020ac2fc3275e46c706d3406e02c3ed79b7be2"
REPO_ID = "xiaowu0162/longmemeval-v2"
CHECKSUMS = {"schema": "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f", "questions": "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7", "trajectories": "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6"}
HAYSTACK_CHECKSUMS = {"small": "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593", "medium": "4756d5126347f0d18f045bb6c47b08cb3b23e9db24386cc48a9b2879e7969b59"}
CONTROL_NAME = "megasaver_lm2_control_v1.json"
CONFIG_KEYS = {"manifest_path", "manifest_digest", "data_revision", "cache_parent", "transport_command", "profile", "embedding_egress", "model", "token_budget", "query_timeout_ms", "index_batch_timeout_ms", "rpc_timeout_seconds"}
def _require(condition: bool, message: str) -> None:
    if not condition: raise RuntimeError(message)
def _number(value: int | float) -> str:
    if isinstance(value, int):
        _require(abs(value) <= 9_007_199_254_740_991, "Unsafe benchmark integer"); return str(value)
    _require(math.isfinite(value), "Non-finite benchmark value")
    if value == 0: return "0"
    sign = "-" if value < 0 else ""; text = repr(abs(value)).lower()
    if "e" not in text: return sign + (text[:-2] if text.endswith(".0") else text)
    coefficient, exponent_text = text.split("e"); exponent = int(exponent_text)
    integer, _, fraction = coefficient.partition("."); digits = integer + fraction; point = len(integer) + exponent
    if 1e-6 <= abs(value) < 1e21:
        if point <= 0: return sign + "0." + "0" * (-point) + digits
        if point >= len(digits): return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    mantissa = digits[0] + (("." + digits[1:]) if len(digits) > 1 else ""); scientific_exponent = point - 1
    return sign + mantissa + "e" + ("+" if scientific_exponent >= 0 else "") + str(scientific_exponent)
def _canonical(value: Any) -> str:
    if value is None: return "null"
    if isinstance(value, bool): return "true" if value else "false"
    if isinstance(value, (int, float)): return _number(value)
    if isinstance(value, str): return json.dumps(unicodedata.normalize("NFC", value), ensure_ascii=False)
    if isinstance(value, list): return "[" + ",".join(_canonical(item) for item in value) + "]"
    _require(isinstance(value, dict) and all(isinstance(key, str) for key in value), "Value is not JSON-compatible")
    pairs = [(unicodedata.normalize("NFC", key), item) for key, item in value.items()]
    _require(len({key for key, _ in pairs}) == len(pairs), "Normalized benchmark keys collide")
    return "{" + ",".join(_canonical(key) + ":" + _canonical(item) for key, item in sorted(pairs)) + "}"
def _digest(value: Any) -> str:
    return sha256(_canonical(value).encode("utf-8")).hexdigest()
def _projection_id(trajectory_id: str, source_kind: str, source_index: int) -> str:
    return str(uuid5(UUID("7d20f05d-6a18-52b8-98e0-8f6c933b3484"), f"{trajectory_id}\0{source_kind}\0{source_index}"))
def _open_file(path: Path) -> tuple[int, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error: raise RuntimeError("Benchmark file is unavailable") from error
    info = os.fstat(descriptor)
    try:
        _require(stat.S_ISREG(info.st_mode), "Benchmark file is not regular"); _require(info.st_nlink == 1, "Benchmark file has aliases"); _require(stat.S_IMODE(info.st_mode) == 0o600, "Benchmark file mode is unsafe")
        if hasattr(os, "geteuid"): _require(info.st_uid == os.geteuid(), "Benchmark file owner mismatch")
        current = path.lstat(); _require((current.st_dev, current.st_ino) == (info.st_dev, info.st_ino), "Benchmark file identity changed")
        return descriptor, info
    except BaseException:
        os.close(descriptor); raise
def _safe_file(path: Path, maximum: int = 64 * 1024 * 1024) -> bytes:
    descriptor, info = _open_file(path)
    try:
        _require(info.st_size <= maximum, "Benchmark file is too large"); chunks: list[bytes] = []; remaining = info.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining)); _require(chunk != b"", "Benchmark file changed while reading"); chunks.append(chunk); remaining -= len(chunk)
        return b"".join(chunks)
    finally: os.close(descriptor)
def _safe_dir(path: Path) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error: raise RuntimeError("Benchmark directory is unavailable") from error
    _require(stat.S_ISDIR(info.st_mode) and not path.is_symlink(), "Unsafe benchmark directory"); _require(stat.S_IMODE(info.st_mode) == 0o700, "Benchmark directory mode is unsafe")
    if hasattr(os, "geteuid"): _require(info.st_uid == os.geteuid(), "Benchmark directory owner mismatch")
    return info
def _anchor_dir(path: Path) -> tuple[int, os.stat_result]:
    descriptor: int | None = None
    try:
        _require(path.is_absolute() and ".." not in path.parts, "Benchmark directory path is unsafe")
        flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0); descriptor = os.open(path.anchor, flags)
        for part in path.parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor); os.close(descriptor); descriptor = child
        info = os.fstat(descriptor); _require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700, "Benchmark directory mode is unsafe")
        if hasattr(os, "geteuid"): _require(info.st_uid == os.geteuid(), "Benchmark directory owner mismatch")
        return descriptor, info
    except BaseException as error:
        if descriptor is not None: os.close(descriptor)
        if isinstance(error, OSError): raise RuntimeError("Benchmark directory is unavailable") from error
        raise
def _json_file(path: Path) -> dict[str, Any]:
    raw = _safe_file(path); value = json.loads(raw)
    _require(isinstance(value, dict) and raw == (_canonical(value) + "\n").encode(), "Benchmark JSON is not canonical")
    return value
def _sha(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)
def _exact(value: object, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys
def _ref(value: object) -> bool:
    return _exact(value, {"id", "fullObjectDigest"}) and isinstance(value["id"], str) and bool(value["id"].strip()) and _sha(value["fullObjectDigest"])
def _timestamp(value: object) -> bool:
    if not isinstance(value, str) or re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", value) is None: return False
    try: datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError: return False
    return True
def _validate_manifest(manifest: object) -> dict[str, Any]:
    root_keys = {"schemaVersion", "officialCommit", "data", "domain", "tier", "questions", "trajectories"}
    _require(_exact(manifest, root_keys), "LM2 manifest fields mismatch")
    data = manifest["data"]; _require(_exact(data, {"repoId", "revision", "checksums"}), "LM2 manifest data mismatch")
    tier = manifest["tier"]; expected_checksums = {**CHECKSUMS, "haystack": HAYSTACK_CHECKSUMS.get(tier)}
    _require(manifest["schemaVersion"] == MANIFEST_VERSION and manifest["officialCommit"] == OFFICIAL_COMMIT, "LM2 manifest version mismatch")
    _require(data == {"repoId": REPO_ID, "revision": DATA_REVISION, "checksums": expected_checksums}, "LM2 manifest data contract mismatch")
    _require(manifest["domain"] in {"web", "enterprise"} and tier in HAYSTACK_CHECKSUMS, "LM2 manifest selection mismatch")
    trajectories, questions = manifest["trajectories"], manifest["questions"]
    _require(isinstance(trajectories, list) and trajectories and isinstance(questions, list) and questions, "LM2 manifest rows missing")
    trajectory_digests: dict[str, str] = {}; projection_keys = {"id", "kind", "sourceKind", "sourceIndex", "text", "observedAt", "sourceDigest", "embeddingInputDigest"}
    for row in trajectories:
        _require(_exact(row, {"id", "fullObjectDigest", "projections"}) and _ref({"id": row["id"], "fullObjectDigest": row["fullObjectDigest"]}), "LM2 trajectory row mismatch")
        _require(row["id"] not in trajectory_digests and isinstance(row["projections"], list) and row["projections"], "LM2 trajectory duplicate or empty")
        trajectory_digests[row["id"]] = row["fullObjectDigest"]
        for projection in row["projections"]:
            _require(_exact(projection, projection_keys), "LM2 projection fields mismatch")
            text, projection_id = projection["text"], projection["id"]; _require(projection["kind"] == "state_snapshot" and projection["sourceKind"] in {"states", "content"}, "LM2 projection kind mismatch")
            _require(isinstance(projection["sourceIndex"], int) and not isinstance(projection["sourceIndex"], bool) and projection["sourceIndex"] >= 0, "LM2 projection index mismatch")
            _require(isinstance(projection_id, str) and projection_id == _projection_id(row["id"], projection["sourceKind"], projection["sourceIndex"]) and _timestamp(projection["observedAt"]), "LM2 projection identity mismatch")
            _require(isinstance(text, str) and text and len(text.encode("utf-16-le")) // 2 <= 50_000 and _sha(projection["sourceDigest"]), "LM2 projection content mismatch")
            embedding = sha256(("megasaver.long-memory.lm2.embedding-input.v1\0" + _canonical({"kind": "state_snapshot", "text": text})).encode()).hexdigest()
            _require(projection["embeddingInputDigest"] == embedding, "LM2 projection embedding mismatch")
    question_keys = {"questionId", "domain", "tier", "questionType", "questionText", "questionTextDigest", "imagePresent", "trajectories", "haystackChainDigest"}; seen: set[str] = set()
    for question in questions:
        _require(_exact(question, question_keys), "LM2 question fields mismatch")
        refs = question["trajectories"]
        _require(isinstance(question["questionId"], str) and question["questionId"] == question["questionId"].strip() and bool(question["questionId"]) and question["questionId"] not in seen and question["domain"] == manifest["domain"] and question["tier"] == tier, "LM2 question selection mismatch")
        _require(isinstance(question["questionType"], str) and question["questionType"].strip() and isinstance(question["questionText"], str) and question["questionText"].strip(), "LM2 question text mismatch")
        _require(isinstance(question["imagePresent"], bool) and isinstance(refs, list) and all(_ref(ref) and trajectory_digests.get(ref["id"]) == ref["fullObjectDigest"] for ref in refs), "LM2 question trajectory mismatch")
        _require(question["questionTextDigest"] == _digest(question["questionText"]) and question["haystackChainDigest"] == _digest(refs), "LM2 question digest mismatch")
        seen.add(question["questionId"])
    return manifest
@register_memory
class MegaSaverLm2HybridMemory(Memory):
    memory_type = "megasaver_lm2_hybrid"
    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        if set(memory_params) != CONFIG_KEYS: raise ValueError("LM2 benchmark config fields mismatch")
        string_fields = ["manifest_path", "manifest_digest", "data_revision", "cache_parent", "profile", "embedding_egress"]
        if not all(isinstance(memory_params.get(key), str) for key in string_fields): raise ValueError("LM2 benchmark config strings are invalid")
        if not Path(str(memory_params["manifest_path"])).is_absolute() or not Path(str(memory_params["cache_parent"])).is_absolute(): raise ValueError("LM2 benchmark paths must be absolute")
        if not _sha(memory_params["manifest_digest"]): raise ValueError("LM2 benchmark manifest digest is invalid")
        if memory_params["data_revision"] != DATA_REVISION: raise ValueError("LM2 benchmark data revision mismatch")
        if memory_params["embedding_egress"] != "local" or memory_params["profile"] not in {"safe", "adaptive"}: raise ValueError("LM2 benchmark embeddings must be local")
        command = memory_params.get("transport_command"); model = memory_params.get("model")
        if not isinstance(command, list) or not 1 <= len(command) <= 16 or not all(isinstance(part, str) and part for part in command): raise ValueError("LM2 benchmark transport command is invalid")
        model_keys = {"provider", "modelId", "revision", "dimensions", "embeddingInputVersion"}; canonical_model_string = lambda key, limit: isinstance(model.get(key), str) and 0 < len(model[key].encode("utf-16-le")) // 2 <= limit and model[key] == unicodedata.normalize("NFC", model[key]).strip()
        if not isinstance(model, dict) or set(model) != model_keys or model.get("provider") != "local" or not canonical_model_string("provider", 128) or not canonical_model_string("modelId", 256) or not canonical_model_string("revision", 256) or not isinstance(model.get("dimensions"), int) or isinstance(model.get("dimensions"), bool) or not 1 <= model["dimensions"] <= 4096 or model.get("embeddingInputVersion") != "lm2-v1": raise ValueError("LM2 benchmark model must be local and canonical")
        integer_bounds = {"token_budget": 100_000, "query_timeout_ms": 2_000, "index_batch_timeout_ms": 15_000}
        if any(not isinstance(memory_params.get(key), int) or isinstance(memory_params.get(key), bool) or not 1 <= memory_params[key] <= bound for key, bound in integer_bounds.items()): raise ValueError("LM2 benchmark numeric config is invalid")
        timeout = memory_params.get("rpc_timeout_seconds")
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0: raise ValueError("LM2 benchmark RPC timeout is invalid")
        self._instance_token = secrets.token_hex(16); self._rejected_token = secrets.token_hex(16)
        self._rejected_identity: tuple[tuple[int, int], tuple[int, int], tuple[int, int]] | None = None
        self._sentinel_token: str | None = None; self._chain: list[dict[str, str]] = []; self._chain_digest = _digest([])
        self._lock = threading.RLock(); self._query_metadata = threading.local(); self._request_number = 0
    def _transport_config(self) -> dict[str, object]:
        mapping = {"manifestPath": "manifest_path", "manifestDigest": "manifest_digest", "dataRevision": "data_revision", "cacheParent": "cache_parent", "profile": "profile", "embeddingEgress": "embedding_egress", "model": "model", "tokenBudget": "token_budget", "queryTimeoutMs": "query_timeout_ms", "indexBatchTimeoutMs": "index_batch_timeout_ms"}
        return {target: self.memory_params[source] for target, source in mapping.items()}
    def _call(self, payload: dict[str, object]) -> dict[str, Any]:
        self._request_number += 1; request_id = f"lm2-{self._request_number}"; request = {"id": request_id, **payload}
        completed = subprocess.run(list(self.memory_params["transport_command"]), input=json.dumps(request, separators=(",", ":")) + "\n", text=True, capture_output=True, timeout=float(self.memory_params["rpc_timeout_seconds"]), check=False)
        _require(completed.returncode == 0, "LM2 benchmark transport failed")
        lines = completed.stdout.splitlines(); _require(len(lines) == 1, "LM2 benchmark transport returned invalid output"); response = json.loads(lines[0])
        _require(isinstance(response, dict) and response.get("id") == request_id and response.get("ok") is True, "LM2 benchmark transport rejected the operation")
        result = response.get("result"); _require(isinstance(result, dict), "LM2 benchmark transport result is invalid")
        return result
    def _ensure_open(self) -> None:
        if self._sentinel_token is not None: return
        result = self._call({"op": "open", "config": self._transport_config(), "instanceToken": self._instance_token})
        token = result.get("sentinelToken"); chain_digest = result.get("chainDigest")
        _require(isinstance(token, str) and len(token) == 32 and isinstance(chain_digest, str), "LM2 open result is invalid")
        self._sentinel_token = token; self._chain_digest = chain_digest
    def _manifest(self) -> dict[str, Any]:
        raw = _safe_file(Path(str(self.memory_params["manifest_path"])), 2 * 1024 * 1024 * 1024)
        _require(raw.endswith(b"\n") and sha256(raw[:-1]).hexdigest() == self.memory_params["manifest_digest"], "LM2 manifest digest mismatch")
        manifest = json.loads(raw); _require((_canonical(manifest) + "\n").encode() == raw, "LM2 manifest is not canonical")
        return _validate_manifest(manifest)
    def _next_trajectory(self, trajectory: dict[str, object]) -> dict[str, str] | None:
        manifest = self._manifest()
        trajectory_id = trajectory.get("id")
        if not isinstance(trajectory_id, str): return None
        target = {"id": trajectory_id, "fullObjectDigest": _digest(trajectory)}
        questions = manifest.get("questions")
        if not isinstance(questions, list) or not any(isinstance(row, dict) and row.get("trajectories", [])[:len(self._chain)] == self._chain and len(row.get("trajectories", [])) > len(self._chain) and row["trajectories"][len(self._chain)] == target for row in questions): return None
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
        if not isinstance(question_id, str): return None
        questions = self._manifest().get("questions")
        if not isinstance(questions, list): return None
        normalized = query.strip()
        return next((row for row in questions if isinstance(row, dict) and row.get("questionId") == question_id and row.get("questionText") == normalized and row.get("questionTextDigest") == _digest(normalized) and row.get("haystackChainDigest") == self._chain_digest), None)
    def _rejected_telemetry(self, image_present: bool) -> dict[str, object]:
        telemetry = {"profile": self.memory_params["profile"], "semanticStatus": "rejected", "rejectionReason": "not_admitted", "observedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"), "auditId": secrets.token_hex(16), "modelFingerprint": _digest(self.memory_params["model"]), "candidateCount": 0, "selectionCount": 0, "latencyMs": 0, "questionType": "unknown", "imagePresent": image_present, "imageUsed": False}
        parent, root, target = None, None, None
        try:
            parent, parent_info = _anchor_dir(Path(str(self.memory_params["cache_parent"])))
            parent_id = (parent_info.st_dev, parent_info.st_ino); creating = self._rejected_identity is None
            if not creating: _require(parent_id == self._rejected_identity[0], "LM2 telemetry parent identity changed")
            root_name = f"rejected-{self._rejected_token}"
            if creating: os.mkdir(root_name, 0o700, dir_fd=parent); os.fsync(parent)
            root = os.open(root_name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent)
            root_info = os.fstat(root); root_current = os.stat(root_name, dir_fd=parent, follow_symlinks=False); root_id = (root_info.st_dev, root_info.st_ino)
            _require(stat.S_ISDIR(root_info.st_mode) and stat.S_IMODE(root_info.st_mode) == 0o700 and root_id == (root_current.st_dev, root_current.st_ino), "LM2 telemetry directory is unsafe")
            if hasattr(os, "geteuid"): _require(root_info.st_uid == os.geteuid(), "LM2 telemetry directory owner mismatch")
            if not creating: _require(root_id == self._rejected_identity[1], "LM2 telemetry directory identity changed")
            flags = os.O_WRONLY | os.O_APPEND | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0)
            if creating: flags |= os.O_CREAT | os.O_EXCL
            target = os.open("queries.jsonl", flags, 0o600, dir_fd=root)
            info = os.fstat(target); current = os.stat("queries.jsonl", dir_fd=root, follow_symlinks=False); file_id = (info.st_dev, info.st_ino)
            _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600 and file_id == (current.st_dev, current.st_ino), "LM2 telemetry file is unsafe")
            if hasattr(os, "geteuid"): _require(info.st_uid == os.geteuid(), "LM2 telemetry owner mismatch")
            if not creating: _require(file_id == self._rejected_identity[2], "LM2 telemetry file identity changed")
            raw = (_canonical(telemetry) + "\n").encode(); _require(os.write(target, raw) == len(raw), "LM2 telemetry write was incomplete"); os.fsync(target)
            final = os.fstat(target); after = os.stat("queries.jsonl", dir_fd=root, follow_symlinks=False); root_final = os.fstat(root); root_after = os.stat(root_name, dir_fd=parent, follow_symlinks=False)
            _require(final.st_nlink == 1 and stat.S_IMODE(final.st_mode) == 0o600 and file_id == (final.st_dev, final.st_ino) == (after.st_dev, after.st_ino) and root_id == (root_final.st_dev, root_final.st_ino) == (root_after.st_dev, root_after.st_ino) and stat.S_IMODE(root_final.st_mode) == 0o700 and (not hasattr(os, "geteuid") or (final.st_uid == os.geteuid() and root_final.st_uid == os.geteuid())), "LM2 telemetry identity changed")
            if creating: os.fsync(root); self._rejected_identity = (parent_id, root_id, file_id)
        except OSError as error:
            raise RuntimeError("LM2 rejected-query telemetry is unavailable") from error
        finally:
            for descriptor in (target, root, parent):
                if descriptor is not None: os.close(descriptor)
        return telemetry
    def query(self, query: str, query_image: str | None = None) -> list[MemoryContextItem]:
        if not isinstance(query, str) or not query.strip(): raise ValueError("LM2 benchmark query must be non-empty")
        with self._lock:
            question = self._admitted_question(query)
            if question is None:
                self._query_metadata.value = self._rejected_telemetry(query_image is not None)
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
            save_info = output_dir.lstat()
            _require(stat.S_ISDIR(save_info.st_mode) and not output_dir.is_symlink(), "Unsafe save directory")
            if hasattr(os, "geteuid"): _require(save_info.st_uid == os.geteuid(), "Save directory owner mismatch")
            os.chmod(output_dir, 0o700, follow_symlinks=False)
            _safe_dir(output_dir)
            canonical_dir = output_dir.resolve(strict=True); info = canonical_dir.stat()
            control = {"schemaVersion": "megasaver-lm2-python-control-v1", "manifestDigest": self.memory_params["manifest_digest"], "dataRevision": DATA_REVISION, "instanceToken": self._instance_token, "sentinelToken": self._sentinel_token, "chain": self._chain, "chainDigest": self._chain_digest, "saveRealpath": str(canonical_dir), "saveDevice": str(info.st_dev), "saveInode": str(info.st_ino)}
            parent_descriptor = os.open(canonical_dir, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
            descriptor = os.open(CONTROL_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=parent_descriptor)
            try:
                os.write(descriptor, (_canonical(control) + "\n").encode())
                os.fsync(descriptor)
                os.fsync(parent_descriptor)
            finally:
                os.close(descriptor); os.close(parent_descriptor)
    def _load_backend(self, input_dir: Path) -> None:
        with self._lock:
            _safe_dir(input_dir); canonical_dir = input_dir.resolve(strict=True); info = canonical_dir.stat()
            control = _json_file(canonical_dir / CONTROL_NAME); required = {"schemaVersion", "manifestDigest", "dataRevision", "instanceToken", "sentinelToken", "chain", "chainDigest", "saveRealpath", "saveDevice", "saveInode"}
            _require(isinstance(control, dict) and set(control) == required, "LM2 saved control fields mismatch"); _require(control["saveRealpath"] == str(canonical_dir) and control["saveDevice"] == str(info.st_dev) and control["saveInode"] == str(info.st_ino), "LM2 save directory identity mismatch")
            chain = control["chain"]; token = lambda value: isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)
            _require(control["schemaVersion"] == "megasaver-lm2-python-control-v1" and token(control["instanceToken"]) and token(control["sentinelToken"]), "LM2 saved control identity mismatch")
            _require(control["manifestDigest"] == self.memory_params["manifest_digest"] and control["dataRevision"] == DATA_REVISION and isinstance(chain, list) and all(_ref(row) for row in chain) and control["chainDigest"] == _digest(chain), "LM2 saved control binding mismatch")
            manifest = self._manifest(); _require(any(question["trajectories"][:len(chain)] == chain for question in manifest["questions"]), "LM2 saved chain is not admitted")
            run = Path(str(self.memory_params["cache_parent"])) / f"instance-{control['instanceToken']}"; run_info = _safe_dir(run); lock_path = run / "run.lock"
            lock_descriptor, lock_info = _open_file(lock_path); locked = False
            try:
                try: fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as error: raise RuntimeError("LM2 run is busy") from error
                locked = True; current = lock_path.lstat(); _require((current.st_dev, current.st_ino) == (lock_info.st_dev, lock_info.st_ino), "LM2 run lock identity changed")
                sentinel = _json_file(run / "sentinel.json"); run_control = _json_file(run / "control.json"); run_keys = {"schemaVersion", "manifestDigest", "dataRevision", "instanceToken", "sentinelToken", "device", "inode", "lockDevice", "lockInode", "chain", "chainDigest"}
                def run_identity(value: dict[str, Any]) -> bool:
                    return _exact(value, run_keys) and value["schemaVersion"] == "megasaver-lm2-run-v1" and value["manifestDigest"] == control["manifestDigest"] and value["dataRevision"] == DATA_REVISION and value["instanceToken"] == control["instanceToken"] and value["sentinelToken"] == control["sentinelToken"] and value["device"] == str(run_info.st_dev) and value["inode"] == str(run_info.st_ino) and value["lockDevice"] == str(lock_info.st_dev) and value["lockInode"] == str(lock_info.st_ino)
                _require(run_identity(sentinel) and sentinel["chain"] == [] and sentinel["chainDigest"] == _digest([]), "LM2 run sentinel mismatch"); _require(run_identity(run_control) and run_control["chain"] == chain and run_control["chainDigest"] == control["chainDigest"], "LM2 run control mismatch")
                final = os.fstat(lock_descriptor); current = lock_path.lstat(); run_current = run.lstat()
                _require(stat.S_ISREG(final.st_mode) and final.st_nlink == 1 and stat.S_IMODE(final.st_mode) == 0o600 and (final.st_dev, final.st_ino) == (lock_info.st_dev, lock_info.st_ino) == (current.st_dev, current.st_ino) and stat.S_ISDIR(run_current.st_mode) and stat.S_IMODE(run_current.st_mode) == 0o700 and (run_current.st_dev, run_current.st_ino) == (run_info.st_dev, run_info.st_ino) and (not hasattr(os, "geteuid") or (final.st_uid == os.geteuid() and run_current.st_uid == os.geteuid())), "LM2 run identity changed")
                self._instance_token = control["instanceToken"]; self._sentinel_token = control["sentinelToken"]; self._chain = control["chain"]; self._chain_digest = control["chainDigest"]
            finally:
                try:
                    if locked: fcntl.flock(lock_descriptor, fcntl.LOCK_UN)
                finally: os.close(lock_descriptor)
