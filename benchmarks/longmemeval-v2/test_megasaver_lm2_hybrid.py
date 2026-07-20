from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

BENCHMARK_DIR = Path(__file__).parent
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))
from lm2_test_support import make_fixture, official_memory_api, secure_mode


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
        rejected = self.fixture["cache_parent"] / f"rejected-{memory._rejected_token}" / "queries.jsonl"
        telemetry = [json.loads(line) for line in rejected.read_text().splitlines()]
        self.assertEqual(len(telemetry), 3)
        self.assertEqual(
            set(telemetry[0]),
            {
                "profile", "semanticStatus", "rejectionReason", "observedAt", "auditId",
                "modelFingerprint", "candidateCount", "selectionCount", "latencyMs",
                "questionType", "imagePresent", "imageUsed",
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

    def test_python_canonical_numbers_match_the_typescript_vector(self) -> None:
        value = {
            "tiny": 1e-7, "threshold": 1e-6, "large": 1e20,
            "scientific": 1e21, "negativeZero": -0.0, "nested": [1.25e-8],
        }
        expected = (
            '{"large":100000000000000000000,"negativeZero":0,'
            '"nested":[1.25e-8],"scientific":1e+21,'
            '"threshold":0.000001,"tiny":1e-7}'
        )
        self.assertEqual(self.backend._canonical(value), expected)
        self.assertEqual(
            self.backend._digest(value),
            "3071e817c07df80c3e924429ecff57c1354a774972a68e8d8df1e212f5d64261",
        )
        self.assertEqual(
            self.backend._digest(self.fixture["trajectories"][0]),
            "2db8d44b938ffc1b07dce0a4cdf863003895af71dcf8a13c2d00f271e5816b8b",
        )

    def test_rejects_self_consistent_manifest_substitution_without_transport(self) -> None:
        mutations = [
            lambda value: value.update(officialCommit="0" * 40),
            lambda value: value["data"].update(repoId="attacker/private"),
            lambda value: value["data"]["checksums"].update(schema="0" * 64),
            lambda value: value.update(tier="medium"),
            lambda value: value["questions"][0].update(extra="poison"),
            lambda value: value["questions"][0].update(haystackChainDigest="0" * 64),
            lambda value: value["trajectories"][0]["projections"][0].update(id="not-uuid"),
            lambda value: value["trajectories"][0]["projections"][0].update(observedAt=7),
            lambda value: value["trajectories"][0]["projections"][0].update(observedAt="2026-99-99T99:99:99Z"),
            lambda value: value["questions"][0].update(questionId=""),
        ]
        original = json.loads(json.dumps(self.fixture["manifest"]))
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                manifest = json.loads(json.dumps(original))
                mutate(manifest)
                raw = self.backend._canonical(manifest) + "\n"
                self.fixture["manifest_path"].write_text(raw, encoding="utf-8")
                self.fixture["config"]["manifest_digest"] = self.backend._digest(manifest)
                memory = self.build_memory(self.memory_config)
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

    def test_load_rejects_alias_corrupt_control_chain_and_replaced_run(self) -> None:
        memory = self.build_indexed()
        save_dir = self.root / "saved-security"
        self.save_memory(memory, save_dir)
        initial_requests = len(self.requests())

        alias = self.root / "saved-alias"
        alias.symlink_to(save_dir, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.load_memory(alias, requested_config=self.memory_config)

        control_path = save_dir / "megasaver_lm2_control_v1.json"
        original = json.loads(control_path.read_text())
        corruptions = [
            {**original, "schemaVersion": "attacker-control"},
            {**original, "chain": [], "chainDigest": self.backend._digest([])},
            {
                **original,
                "chain": [{"id": "trajectory-one", "fullObjectDigest": "0" * 64}],
                "chainDigest": self.backend._digest(
                    [{"id": "trajectory-one", "fullObjectDigest": "0" * 64}]
                ),
            },
        ]
        for control in corruptions:
            with self.subTest(control=control):
                control_path.write_text(self.backend._canonical(control) + "\n")
                with self.assertRaises(RuntimeError):
                    self.load_memory(save_dir, requested_config=self.memory_config)
        control_path.write_text(self.backend._canonical(original) + "\n")

        run = self.fixture["cache_parent"] / f"instance-{memory._instance_token}"
        displaced = self.root / "displaced-run"
        run.rename(displaced)
        shutil.copytree(displaced, run)
        with self.assertRaises(RuntimeError):
            self.load_memory(save_dir, requested_config=self.memory_config)
        self.assertEqual(len(self.requests()), initial_requests)


if __name__ == "__main__":
    unittest.main()
