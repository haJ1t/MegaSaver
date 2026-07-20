from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import stat
import textwrap
from uuid import UUID, uuid5


DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b"


def number(value: int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    text = repr(abs(value)).lower()
    if "e" not in text:
        return sign + (text[:-2] if text.endswith(".0") else text)
    coefficient, exponent_text = text.split("e")
    integer, _, fraction = coefficient.partition(".")
    digits = integer + fraction
    point = len(integer) + int(exponent_text)
    if 1e-6 <= abs(value) < 1e21:
        if point <= 0:
            return sign + "0." + "0" * (-point) + digits
        if point >= len(digits):
            return sign + digits + "0" * (point - len(digits))
        return sign + digits[:point] + "." + digits[point:]
    exponent = point - 1
    return sign + digits[0] + (("." + digits[1:]) if len(digits) > 1 else "") + "e" + ("+" if exponent >= 0 else "") + str(exponent)


def canonical(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in sorted(value)) + "}"


def digest(value: object) -> str:
    return sha256(canonical(value).encode()).hexdigest()


def projection(trajectory_id: str, source_kind: str, index: int, source: dict[str, object], ordinal: int) -> dict[str, object]:
    if source_kind == "states":
        text = source.get("accessibility_tree") or source.get("text")
    else:
        text = source["observation"]["text"]
    embedding = "megasaver.long-memory.lm2.embedding-input.v1\0" + canonical(
        {"kind": "state_snapshot", "text": text}
    )
    name = f"{trajectory_id}\0{source_kind}\0{index}"
    return {
        "id": str(uuid5(UUID("7d20f05d-6a18-52b8-98e0-8f6c933b3484"), name)),
        "kind": "state_snapshot",
        "sourceKind": source_kind,
        "sourceIndex": index,
        "text": text,
        "observedAt": f"2000-01-01T00:00:00.{ordinal:03d}Z",
        "sourceDigest": digest(source),
        "embeddingInputDigest": sha256(embedding.encode()).hexdigest(),
    }


def make_fixture(root: Path) -> dict[str, object]:
    cache_parent = root / "cache"
    cache_parent.mkdir(mode=0o700)
    trajectories = [
        {
            "id": "trajectory-one",
            "scientific": {"tiny": 1e-7, "large": 1e20},
            "states": [{"accessibility_tree": "billing paid"}],
        },
        {"id": "trajectory-two", "content": [{"observation": {"text": "approval pending"}}]},
    ]
    refs = [{"id": row["id"], "fullObjectDigest": digest(row)} for row in trajectories]
    manifest = {
        "schemaVersion": "megasaver-lm2-manifest-v1",
        "officialCommit": "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
        "data": {
            "repoId": "xiaowu0162/longmemeval-v2",
            "revision": DATA_REVISION,
            "checksums": {
                "schema": "0672cf47cf16c30365648770628b433076bb3f5b73edded673af7dd6d5f3246f",
                "questions": "0a3ae5ebea938c24d7800e1e0b0828e08ae1646f939a53853b2b8cdc08e292b7",
                "trajectories": "363cec9a8e87aa8d9101ce4e600aadbf7031d674056ebe4f969e8424abc5f3c6",
                "haystack": "9b5301defb23a088a5f06e45ff8d5f35e569d78305a66d492046a9fff9b46593",
            },
        },
        "domain": "web",
        "tier": "small",
        "questions": [
            {
                "questionId": "question-one",
                "domain": "web",
                "tier": "small",
                "questionType": "dynamic-environment",
                "questionText": "What is the billing status?",
                "questionTextDigest": digest("What is the billing status?"),
                "imagePresent": False,
                "trajectories": refs,
                "haystackChainDigest": digest(refs),
            }
        ],
        "trajectories": [
            {
                "id": trajectories[0]["id"],
                "fullObjectDigest": digest(trajectories[0]),
                "projections": [
                    projection("trajectory-one", "states", 0, trajectories[0]["states"][0], 0)
                ],
            },
            {
                "id": trajectories[1]["id"],
                "fullObjectDigest": digest(trajectories[1]),
                "projections": [
                    projection("trajectory-two", "content", 0, trajectories[1]["content"][0], 1)
                ],
            },
        ],
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(canonical(manifest) + "\n", encoding="utf-8")
    os.chmod(manifest_path, 0o600)
    request_log = root / "requests.jsonl"
    fake_transport = root / "fake_transport.py"
    first_digest = digest(refs[:1])
    full_digest = digest(refs)
    fake_transport.write_text(
        textwrap.dedent(
            f"""\
            import json
            from pathlib import Path
            import secrets
            import sys

            log = Path(sys.argv[1])
            request = json.loads(sys.stdin.readline())
            with log.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(request, separators=(",", ":")) + "\\n")
            if request["op"] == "open":
                token = secrets.token_hex(16)
                run = Path(request["config"]["cacheParent"]) / ("instance-" + request["instanceToken"])
                run.mkdir(mode=0o700)
                (run / "cache").mkdir(mode=0o700)
                (run / "telemetry").mkdir(mode=0o700)
                (run / "run.lock").write_text("", encoding="utf-8")
                (run / "run.lock").chmod(0o600)
                (run / "telemetry" / "queries.jsonl").write_text("", encoding="utf-8")
                (run / "telemetry" / "queries.jsonl").chmod(0o600)
                run_info = run.stat()
                lock_info = (run / "run.lock").stat()
                sentinel = {{"schemaVersion": "megasaver-lm2-run-v1", "manifestDigest": request["config"]["manifestDigest"], "dataRevision": request["config"]["dataRevision"], "instanceToken": request["instanceToken"], "sentinelToken": token, "device": str(run_info.st_dev), "inode": str(run_info.st_ino), "lockDevice": str(lock_info.st_dev), "lockInode": str(lock_info.st_ino), "chain": [], "chainDigest": "{digest([])}"}}
                (run / "sentinel.json").write_text(json.dumps(sentinel, separators=(",", ":"), sort_keys=True) + "\\n", encoding="utf-8")
                (run / "sentinel.json").chmod(0o600)
                (run / "control.json").write_text(json.dumps(sentinel, separators=(",", ":"), sort_keys=True) + "\\n", encoding="utf-8")
                (run / "control.json").chmod(0o600)
                result = {{"sentinelToken": token, "chainDigest": "{digest([])}", "insertedCount": 0}}
            elif request["op"] == "insert":
                count = 1 if request["trajectory"]["id"] == "trajectory-one" else 2
                run = Path(request["config"]["cacheParent"]) / ("instance-" + request["instanceToken"])
                control = json.loads((run / "control.json").read_text())
                control["chain"] = {json.dumps(refs)}[:count]
                control["chainDigest"] = "{first_digest}" if count == 1 else "{full_digest}"
                (run / "control.json").write_text(json.dumps(control, separators=(",", ":"), sort_keys=True) + "\\n", encoding="utf-8")
                result = {{"chainDigest": "{first_digest}" if count == 1 else "{full_digest}", "insertedCount": count, "indexingComplete": True}}
            else:
                result = {{"items": [{{"type": "text", "value": "billing paid"}}, {{"type": "text", "value": ""}}, {{"type": "image", "value": "/private.png"}}], "telemetry": {{"semanticStatus": "used"}}}}
            print(json.dumps({{"id": request["id"], "ok": True, "result": result}}))
            """
        ),
        encoding="utf-8",
    )
    config = {
        "manifest_path": str(manifest_path),
        "manifest_digest": digest(manifest),
        "data_revision": DATA_REVISION,
        "cache_parent": str(cache_parent),
        "transport_command": [os.environ.get("PYTHON", os.sys.executable), str(fake_transport), str(request_log)],
        "profile": "adaptive",
        "embedding_egress": "local",
        "model": {
            "provider": "local",
            "modelId": "hash",
            "revision": "v1",
            "dimensions": 64,
            "embeddingInputVersion": "lm2-v1",
        },
        "token_budget": 2000,
        "query_timeout_ms": 1500,
        "index_batch_timeout_ms": 15000,
        "rpc_timeout_seconds": 5,
    }
    return {
        "cache_parent": cache_parent,
        "config": config,
        "manifest": manifest,
        "manifest_path": manifest_path,
        "request_log": request_log,
        "trajectories": trajectories,
    }


def secure_mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)
