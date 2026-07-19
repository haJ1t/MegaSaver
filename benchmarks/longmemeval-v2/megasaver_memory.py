from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import selectors
import shlex
import subprocess
from typing import Any, TypedDict
from uuid import NAMESPACE_URL, uuid5


MAX_OBSERVATION_TEXT_CHARS = 50_000
MAX_RECALL_TOKEN_BUDGET = 100_000

try:
    from memory_modules.memory import Memory, MemoryContextItem, register_memory
except ModuleNotFoundError as error:
    if error.name != "memory_modules":
        raise

    class MemoryContextItem(TypedDict):
        type: str
        value: str

    class Memory:
        def __init__(self, memory_params: dict[str, object]) -> None:
            self.memory_params = dict(memory_params)

    def register_memory(memory_class: type[Memory]) -> type[Memory]:
        return memory_class


def sha256_hex(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def observation_digest(trajectory_id: str, state_index: int, text: str) -> str:
    canonical = json.dumps(
        {"stateIndex": state_index, "text": text, "trajectoryId": trajectory_id},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return sha256_hex(canonical)


def utf16_code_units(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def bounded_observation_text(text: str) -> str:
    if utf16_code_units(text) <= MAX_OBSERVATION_TEXT_CHARS:
        return text

    marker = "\n...[truncated]...\n"
    available_units = MAX_OBSERVATION_TEXT_CHARS - utf16_code_units(marker)
    prefix: list[str] = []
    used_units = 0
    for character in text:
        character_units = utf16_code_units(character)
        if used_units + character_units > available_units:
            break
        prefix.append(character)
        used_units += character_units
    return f"{''.join(prefix)}{marker}"


@register_memory
class MegaSaverLongMemory(Memory):
    memory_type = "megasaver_long_memory"

    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        data_root = memory_params.get("data_root")
        node_command = memory_params.get("node_command")
        token_budget = memory_params.get("token_budget", 2_000)
        rpc_timeout_seconds = memory_params.get("rpc_timeout_seconds", 30.0)

        if not isinstance(data_root, str) or not data_root.strip():
            raise ValueError("data_root must be a non-empty string")
        if not isinstance(node_command, str) or not node_command.strip():
            raise ValueError("node_command must be a non-empty string")
        if (
            not isinstance(token_budget, int)
            or isinstance(token_budget, bool)
            or not 0 < token_budget <= MAX_RECALL_TOKEN_BUDGET
        ):
            raise ValueError(
                f"token_budget must be an integer from 1 to {MAX_RECALL_TOKEN_BUDGET}"
            )
        if (
            not isinstance(rpc_timeout_seconds, (int, float))
            or isinstance(rpc_timeout_seconds, bool)
            or rpc_timeout_seconds <= 0
        ):
            raise ValueError("rpc_timeout_seconds must be positive")

        self.data_root = Path(data_root).resolve()
        if not self.data_root.is_dir():
            raise ValueError("data_root must be an existing directory")

        self.workspace_key = sha256_hex(str(self.data_root))
        self.token_budget = token_budget
        self.rpc_timeout_seconds = float(rpc_timeout_seconds)
        self._request_count = 0
        self._process = subprocess.Popen(
            shlex.split(node_command),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def close(self) -> None:
        if self._process is None:
            return

        process = self._process
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()

        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

        if process.stdout is not None and not process.stdout.closed:
            process.stdout.close()

        self._process = None

    def insert(self, trajectory: dict[str, object]) -> None:
        trajectory_id = trajectory.get("id")

        if not isinstance(trajectory_id, str) or not trajectory_id.strip():
            raise ValueError("trajectory id must be a non-empty string")

        for index, text in enumerate(self._trajectory_state_texts(trajectory)):
            source_digest = observation_digest(trajectory_id, index, text)
            observation_text = bounded_observation_text(text)

            self._rpc(
                {
                    "op": "insert",
                    "observation": {
                        "id": str(uuid5(NAMESPACE_URL, source_digest)),
                        "workspaceKey": self.workspace_key,
                        "sourceDigest": source_digest,
                        "kind": "state_snapshot",
                        "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "text": observation_text,
                        "evidenceIds": [f"trajectory-state:{source_digest}"],
                    },
                }
            )

    def query(
        self,
        query: str,
        query_image: str | None = None,
    ) -> list[MemoryContextItem]:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be a non-empty string")

        result = self._rpc(
            {
                "op": "query",
                "request": {
                    "task": query,
                    "workspaceKey": self.workspace_key,
                    "tokenBudget": self.token_budget,
                },
            }
        )
        items = result.get("items")
        if not isinstance(items, list):
            raise RuntimeError("Mega Saver RPC query result has no items list")

        context: list[MemoryContextItem] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            value = item.get("value")
            if item_type == "text" and isinstance(value, str) and value.strip():
                context.append({"type": "text", "value": value})
            if item_type == "image" and isinstance(value, str):
                checked_path = self._checked_image_path(value)
                if checked_path is not None:
                    context.append({"type": "image", "value": checked_path})

        return context

    def _trajectory_state_texts(self, trajectory: dict[str, object]) -> list[str]:
        states = trajectory.get("states")
        if isinstance(states, list) and states:
            texts: list[str] = []
            for index, state in enumerate(states):
                if not isinstance(state, dict):
                    raise ValueError(f"trajectory state {index} must be an object")
                text = state.get("accessibility_tree", state.get("text"))
                if not isinstance(text, str) or not text.strip():
                    raise ValueError(f"trajectory state {index} has no text")
                texts.append(text)
            return texts

        content = trajectory.get("content")
        if not isinstance(content, list) or not content:
            raise ValueError("trajectory must contain non-empty states or content")

        texts = []
        for index, state in enumerate(content):
            if not isinstance(state, dict):
                raise ValueError(f"trajectory content {index} must be an object")
            observation = state.get("observation")
            if not isinstance(observation, dict):
                raise ValueError(f"trajectory content {index} has no observation")
            text = observation.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"trajectory content {index} has no observation text")
            texts.append(text)
        return texts

    def _checked_image_path(self, image_path: str) -> str | None:
        candidate = Path(image_path).resolve()

        try:
            candidate.relative_to(self.data_root)
        except ValueError:
            return None

        if not candidate.is_file():
            return None
        return str(candidate)

    def _rpc(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._process is None or self._process.stdin is None or self._process.stdout is None:
            raise RuntimeError("Mega Saver RPC process is closed")
        if self._process.poll() is not None:
            raise RuntimeError(f"Mega Saver RPC process exited with code {self._process.returncode}")

        self._request_count += 1
        request_id = f"megasaver-{self._request_count}"
        request = {"id": request_id, **payload}
        self._process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self._process.stdin.flush()
        selector = selectors.DefaultSelector()
        selector.register(self._process.stdout, selectors.EVENT_READ)
        try:
            if not selector.select(self.rpc_timeout_seconds):
                self.close()
                raise TimeoutError("Mega Saver RPC process timed out")
            line = self._process.stdout.readline()
        finally:
            selector.close()

        if not line:
            raise RuntimeError(
                f"Mega Saver RPC process closed without a response (code {self._process.poll()})"
            )

        response = json.loads(line)
        if not isinstance(response, dict) or response.get("id") != request_id:
            raise RuntimeError("Mega Saver RPC response has an unexpected id")
        if response.get("ok") is not True:
            raise RuntimeError(f"Mega Saver RPC error: {response.get('error')}")

        result = response.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("Mega Saver RPC response has no result object")
        return result
