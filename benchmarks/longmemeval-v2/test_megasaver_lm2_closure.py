from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

BENCHMARK_DIR = Path(__file__).parent
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))
from lm2_test_support import make_fixture, official_memory_api, secure_mode
from test_megasaver_lm2_hybrid import load_backend


class MegaSaverLm2ClosureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        build_memory, _, _ = official_memory_api()
        cls.build_memory = staticmethod(build_memory)
        cls.backend = load_backend()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        os.chmod(self.root, 0o700)
        self.fixture = make_fixture(self.root)
        self.memory_config = {
            "memory_type": "megasaver_lm2_hybrid",
            "memory_params": self.fixture["config"],
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def requests(self) -> list[dict[str, object]]:
        path = self.fixture["request_log"]
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines()]

    def rejected_path(self, memory) -> Path:
        return (
            self.fixture["cache_parent"]
            / f"rejected-{memory._rejected_token}"
            / "queries.jsonl"
        )

    def test_pre_open_rejection_writes_durable_redacted_telemetry_without_transport(self) -> None:
        memory = self.build_memory(self.memory_config)
        memory.set_query_context(
            question_id="unknown",
            question_item={"answer": "poison", "eval_function": str(self.root)},
        )

        self.assertEqual(memory.query("Substituted question", query_image="/private.png"), [])

        telemetry_path = self.rejected_path(memory)
        self.assertEqual(secure_mode(telemetry_path), 0o600)
        telemetry = json.loads(telemetry_path.read_text())
        self.assertEqual(telemetry["semanticStatus"], "rejected")
        self.assertEqual(telemetry["imagePresent"], True)
        self.assertNotIn("poison", json.dumps(telemetry))
        self.assertNotIn(str(self.root), json.dumps(telemetry))
        self.assertEqual(self.requests(), [])

    def test_fifo_rejected_telemetry_path_fails_without_blocking_or_transport(self) -> None:
        memory = self.build_memory(self.memory_config)
        memory.set_query_context(question_id="unknown")
        self.assertEqual(memory.query("First substituted question"), [])
        telemetry_path = self.rejected_path(memory)
        telemetry_path.rename(telemetry_path.with_name("original.jsonl"))
        os.mkfifo(telemetry_path, 0o600)

        with self.assertRaises(RuntimeError):
            memory.query("Second substituted question")

        self.assertEqual(self.requests(), [])

    def test_replaced_cache_parent_cannot_redirect_rejected_telemetry(self) -> None:
        memory = self.build_memory(self.memory_config)
        memory.set_query_context(question_id="unknown")
        self.assertEqual(memory.query("First substituted question"), [])
        original_parent = self.fixture["cache_parent"]
        original_file = self.rejected_path(memory)
        displaced = self.root / "displaced-cache"
        original_parent.rename(displaced)
        original_parent.mkdir(mode=0o700)

        with self.assertRaises(RuntimeError):
            memory.query("Second substituted question")

        self.assertEqual(list(original_parent.iterdir()), [])
        displaced_file = displaced / original_file.relative_to(original_parent)
        self.assertEqual(len(displaced_file.read_text().splitlines()), 1)
        self.assertEqual(self.requests(), [])

    def test_hardlinked_rejected_telemetry_fails_without_transport(self) -> None:
        memory = self.build_memory(self.memory_config)
        memory.set_query_context(question_id="unknown")
        self.assertEqual(memory.query("First substituted question"), [])
        telemetry_path = self.rejected_path(memory)
        os.link(telemetry_path, telemetry_path.with_name("alias.jsonl"))

        with self.assertRaises(RuntimeError):
            memory.query("Second substituted question")

        self.assertEqual(len(telemetry_path.read_text().splitlines()), 1)
        self.assertEqual(self.requests(), [])

    def test_malformed_local_model_descriptors_fail_before_transport(self) -> None:
        invalid_models = [
            {"dimensions": True},
            {"dimensions": 0},
            {"dimensions": 4097},
            {"dimensions": 1.5},
            {"modelId": ""},
            {"modelId": " padded "},
            {"modelId": "😀" * 129},
            {"revision": "e\u0301"},
            {"embeddingInputVersion": "lm2-v2"},
        ]
        for changes in invalid_models:
            with self.subTest(changes=changes):
                config = json.loads(json.dumps(self.memory_config))
                config["memory_params"]["model"].update(changes)
                with self.assertRaises(ValueError):
                    self.build_memory(config)
        self.assertEqual(self.requests(), [])


if __name__ == "__main__":
    unittest.main()
