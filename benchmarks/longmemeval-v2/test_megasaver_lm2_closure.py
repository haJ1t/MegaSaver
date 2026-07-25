from __future__ import annotations

import fcntl
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
        build_memory, load_memory, save_memory = official_memory_api()
        cls.build_memory = staticmethod(build_memory)
        cls.load_memory = staticmethod(load_memory)
        cls.save_memory = staticmethod(save_memory)
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

    def build_indexed(self):
        memory = self.build_memory(self.memory_config)
        for trajectory in self.fixture["trajectories"]:
            memory.insert(trajectory)
        return memory

    def test_pre_open_rejection_writes_durable_redacted_telemetry_without_transport(self) -> None:
        memory = self.build_memory(self.memory_config)
        raw_question_id = "raw-private-question-id-37"
        memory.set_query_context(
            question_id=raw_question_id,
            question_item={"answer": "poison", "eval_function": str(self.root)},
        )

        context = memory.query("Substituted question", query_image="/private.png")
        self.assertEqual(context, [])
        metadata = memory.post_query_hook(
            query="Substituted question", query_image="/private.png", memory_context=context
        )

        telemetry_path = self.rejected_path(memory)
        self.assertEqual(secure_mode(telemetry_path), 0o600)
        raw_telemetry = telemetry_path.read_text()
        telemetry = json.loads(raw_telemetry)
        self.assertEqual(telemetry["semanticStatus"], "rejected")
        self.assertEqual(telemetry["rejectionReason"], "not_admitted")
        self.assertTrue(self.backend._timestamp(telemetry["observedAt"]))
        self.assertRegex(telemetry["auditId"], r"^[0-9a-f]{32}$")
        self.assertEqual(telemetry["imagePresent"], True)
        self.assertNotIn("questionId", telemetry)
        self.assertNotIn(raw_question_id, raw_telemetry)
        self.assertNotIn("poison", json.dumps(telemetry))
        self.assertNotIn(str(self.root), json.dumps(telemetry))
        self.assertEqual(metadata, telemetry)
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

    def test_load_rejects_a_concurrently_held_run_lock_without_transport(self) -> None:
        memory = self.build_indexed()
        save_dir = self.root / "saved-held-lock"
        self.save_memory(memory, save_dir)
        initial_requests = len(self.requests())
        lock_path = self.fixture["cache_parent"] / f"instance-{memory._instance_token}" / "run.lock"
        descriptor = os.open(lock_path, os.O_RDONLY)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            with self.assertRaises(RuntimeError):
                self.load_memory(save_dir, requested_config=self.memory_config)
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
        self.assertEqual(len(self.requests()), initial_requests)

    def test_load_rejects_lock_replacement_during_state_read_and_releases_lock(self) -> None:
        memory = self.build_indexed()
        save_dir = self.root / "saved-lock-race"
        self.save_memory(memory, save_dir)
        initial_requests = len(self.requests())
        run = self.fixture["cache_parent"] / f"instance-{memory._instance_token}"
        lock_path = run / "run.lock"
        displaced = run / "displaced.lock"
        replacement = run / "replacement.lock"
        replacement.write_bytes(b"")
        os.chmod(replacement, 0o600)
        original_json_file = self.backend._json_file
        replaced = False

        def replace_lock_then_read(path):
            nonlocal replaced
            if path.name == "sentinel.json" and not replaced:
                lock_path.rename(displaced)
                replacement.rename(lock_path)
                replaced = True
            return original_json_file(path)

        self.backend._json_file = replace_lock_then_read
        try:
            with self.assertRaises(RuntimeError):
                self.load_memory(save_dir, requested_config=self.memory_config)
        finally:
            self.backend._json_file = original_json_file
        self.assertTrue(replaced)
        descriptor = os.open(displaced, os.O_RDONLY)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)
        self.assertEqual(len(self.requests()), initial_requests)


if __name__ == "__main__":
    unittest.main()
