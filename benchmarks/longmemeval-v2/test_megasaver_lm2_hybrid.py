from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest

BENCHMARK_DIR = Path(__file__).parent
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))
from lm2_test_support import make_fixture, secure_mode


BACKEND_PATH = BENCHMARK_DIR / "megasaver_lm2_hybrid.py"


def load_backend():
    spec = importlib.util.spec_from_file_location(
        "memory_modules.megasaver_lm2_hybrid", BACKEND_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load LM2 benchmark backend")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class MegaSaverLm2HybridTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        official_root = os.environ.get("LONGMEMEVAL_V2_ROOT")
        if official_root:
            root = str(Path(official_root).resolve())
            if root not in sys.path:
                sys.path.insert(0, root)
            for module_name, class_name in {
                "no_retrieval": "NoRetrievalMemory",
                "codex": "CodexMemory",
                "agentrunbook_c": "AgentRunbookC",
                "agentrunbook_c_v2": "AgentRunbookCV2",
                "agentrunbook_r": "AgentRunbookR",
                "rag": "RagMemory",
            }.items():
                module = types.ModuleType(f"memory_modules.{module_name}")
                setattr(module, class_name, type(class_name, (), {}))
                sys.modules[module.__name__] = module
            from memory_modules.memory import build_memory, load_memory, save_memory

            cls.build_memory = staticmethod(build_memory)
            cls.load_memory = staticmethod(load_memory)
            cls.save_memory = staticmethod(save_memory)
        else:
            raise unittest.SkipTest("LONGMEMEVAL_V2_ROOT must name the pinned official checkout")
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

    def build_indexed(self):
        memory = self.build_memory(self.memory_config)
        for trajectory in self.fixture["trajectories"]:
            memory.insert(trajectory)
        return memory

    def test_constructor_is_lazy_and_rejects_remote_config_without_io(self) -> None:
        memory = self.build_memory(self.memory_config)
        self.assertEqual(list(self.fixture["cache_parent"].iterdir()), [])
        self.assertEqual(self.requests(), [])
        self.assertEqual(memory.memory_config, self.memory_config)

        remote = json.loads(json.dumps(self.memory_config))
        remote["memory_params"]["embedding_egress"] = "remote"
        with self.assertRaises(ValueError):
            self.build_memory(remote)
        self.assertEqual(self.requests(), [])

    def test_insert_and_admitted_query_use_one_process_per_operation(self) -> None:
        memory = self.build_indexed()
        memory.set_query_context(
            question_id="question-one",
            question_type="dynamic-environment",
            question_item={"answer": "poison", "eval_function": "poison"},
        )

        context = memory.query("What is the billing status?", query_image="/private.png")
        metadata = memory.post_query_hook(
            query="What is the billing status?",
            query_image="/private.png",
            memory_context=context,
        )

        self.assertEqual(context, [{"type": "text", "value": "billing paid"}])
        self.assertEqual([row["op"] for row in self.requests()], ["open", "insert", "insert", "query"])
        query_request = self.requests()[-1]
        self.assertNotIn("question_item", query_request)
        self.assertNotIn("query_image", query_request)
        self.assertEqual(query_request["queryImagePresent"], True)
        self.assertEqual(metadata, {"semanticStatus": "used"})

    def test_actual_built_transport_when_configured(self) -> None:
        transport = os.environ.get("MEGASAVER_LM2_TRANSPORT")
        if not transport:
            self.skipTest("MEGASAVER_LM2_TRANSPORT is not configured")
        self.fixture["config"]["transport_command"] = ["node", str(Path(transport).resolve())]
        self.memory_config["memory_params"] = self.fixture["config"]
        memory = self.build_indexed()
        memory.set_query_context(question_id="question-one")
        context = memory.query("What is the billing status?")
        self.assertTrue(context)
        self.assertTrue(all(item["type"] == "text" and item["value"].strip() for item in context))

    def test_rejected_queries_launch_no_transport_and_ignore_poisoned_context(self) -> None:
        memory = self.build_indexed()
        initial_count = len(self.requests())
        cases = [
            ({}, "What is the billing status?"),
            ({"question_id": "unknown", "question_item": {"answer": "poison"}}, "What is the billing status?"),
            ({"question_id": "question-one", "question_item": {"eval_function": "poison"}}, "Substituted query"),
        ]
        for context, query in cases:
            memory.set_query_context(**context)
            self.assertEqual(memory.query(query), [])
        self.assertEqual(len(self.requests()), initial_count)
        run = self.fixture["cache_parent"] / f"instance-{memory._instance_token}"
        telemetry = [
            json.loads(line)
            for line in (run / "telemetry/queries.jsonl").read_text().splitlines()
        ]
        self.assertEqual(len(telemetry), 3)
        self.assertEqual(
            set(telemetry[0]),
            {
                "profile", "semanticStatus", "modelFingerprint", "candidateCount",
                "selectionCount", "latencyMs", "questionId", "questionType",
                "imagePresent", "imageUsed",
            },
        )
        self.assertNotIn("poison", json.dumps(telemetry))
        self.assertNotIn(str(self.root), json.dumps(telemetry))

    def test_rejects_mutated_trajectory_and_unsafe_manifest_before_transport(self) -> None:
        memory = self.build_memory(self.memory_config)
        mutated = json.loads(json.dumps(self.fixture["trajectories"][0]))
        mutated["states"][0]["accessibility_tree"] = "substituted private state"
        with self.assertRaises(RuntimeError):
            memory.insert(mutated)
        self.assertEqual(self.requests(), [])

        manifest_path = self.fixture["manifest_path"]
        original = manifest_path.with_suffix(".original")
        manifest_path.rename(original)
        manifest_path.symlink_to(original)
        with self.assertRaises(RuntimeError):
            memory.insert(self.fixture["trajectories"][0])
        self.assertEqual(self.requests(), [])

    def test_official_save_load_accepts_only_original_directory_identity(self) -> None:
        memory = self.build_indexed()
        save_dir = self.root / "saved"
        self.save_memory(memory, save_dir)
        control = save_dir / "megasaver_lm2_control_v1.json"
        self.assertEqual(secure_mode(control), 0o600)

        loaded = self.load_memory(save_dir, requested_config=self.memory_config)
        loaded.set_query_context(question_id="question-one")
        self.assertEqual(loaded.query("What is the billing status?"), [{"type": "text", "value": "billing paid"}])

        copied = self.root / "copied"
        shutil.copytree(save_dir, copied)
        with self.assertRaises(RuntimeError):
            self.load_memory(copied, requested_config=self.memory_config)

        linked = self.root / "linked"
        linked.mkdir()
        shutil.copy2(save_dir / "memory_config.json", linked / "memory_config.json")
        os.link(control, linked / control.name)
        with self.assertRaises(RuntimeError):
            self.load_memory(linked, requested_config=self.memory_config)

        moved = self.root / "moved"
        save_dir.rename(moved)
        with self.assertRaises(RuntimeError):
            self.load_memory(moved, requested_config=self.memory_config)


if __name__ == "__main__":
    unittest.main()
