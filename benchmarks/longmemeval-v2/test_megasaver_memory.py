from __future__ import annotations

import importlib.util
import json
import shlex
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


BENCHMARK_DIR = Path(__file__).parent
ADAPTER_PATH = BENCHMARK_DIR / "megasaver_memory.py"


def load_adapter():
    spec = importlib.util.spec_from_file_location("megasaver_memory", ADAPTER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Mega Saver LongMemEval adapter")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class MegaSaverLongMemoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.data_root = self.root / "public-data"
        self.data_root.mkdir()
        self.requests_path = self.root / "requests.jsonl"
        self.fake_node = self.root / "fake-node.py"
        self.fake_node.write_text(
            textwrap.dedent(
                """\
                import json
                import sys
                from pathlib import Path
                import time

                request_log = Path(sys.argv[1])
                silent = "--silent" in sys.argv
                observations = []
                for line in sys.stdin:
                    if silent:
                        time.sleep(0.1)
                    request = json.loads(line)
                    request_log.open("a", encoding="utf-8").write(json.dumps(request) + "\\n")
                    if request["op"] == "insert":
                        if len(request["observation"]["text"].encode("utf-16-le")) // 2 > 50000:
                            print(json.dumps({"id": request["id"], "ok": False, "error": {"code": "invalid_request"}}), flush=True)
                            continue
                        observations.append(request["observation"])
                        response = {"id": request["id"], "ok": True, "result": {"inserted": True}}
                    else:
                        response = {
                            "id": request["id"],
                            "ok": True,
                            "result": {
                                "items": [
                                    {
                                        "type": "text",
                                        "value": item["text"],
                                        "observationId": item["id"],
                                    }
                                    for item in observations
                                ],
                                "receipt": [],
                            },
                        }
                    print(json.dumps(response), flush=True)
                """
            ),
            encoding="utf-8",
        )
        self.adapter = load_adapter()
        self.memory = self.adapter.MegaSaverLongMemory(
            {
                "data_root": str(self.data_root),
                "node_command": f"{shlex.quote(sys.executable)} {shlex.quote(str(self.fake_node))} {shlex.quote(str(self.requests_path))}",
            }
        )

    def tearDown(self) -> None:
        self.memory.close()
        self.temp_dir.cleanup()

    def test_indexes_public_state_trajectory_and_returns_text_context(self) -> None:
        self.memory.insert(
            {
                "id": "trajectory-1",
                "states": [{"accessibility_tree": "billing status is paid"}],
            }
        )

        self.assertEqual(
            self.memory.query("What is the billing status?"),
            [{"type": "text", "value": "billing status is paid"}],
        )

        requests = [
            json.loads(line)
            for line in self.requests_path.read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(requests[0]["observation"]["workspaceKey"], self.memory.workspace_key)
        self.assertEqual(
            requests[0]["observation"]["sourceDigest"],
            self.adapter.observation_digest("trajectory-1", 0, "billing status is paid"),
        )

    def test_indexes_content_trajectory_text(self) -> None:
        self.memory.insert(
            {
                "id": "trajectory-2",
                "content": [{"observation": {"text": "change request is approved"}}],
            }
        )

        self.assertEqual(
            self.memory.query("What is the request status?"),
            [{"type": "text", "value": "change request is approved"}],
        )

    def test_canonical_digest_distinguishes_delimiter_collisions(self) -> None:
        self.assertNotEqual(
            self.adapter.observation_digest("a", 1, "2:x"),
            self.adapter.observation_digest("a:1", 2, "x"),
        )

    def test_aligns_utf16_text_and_token_budget_boundaries_with_node(self) -> None:
        self.memory.insert(
            {
                "id": "trajectory-emoji",
                "states": [{"text": "😀" * 30_000}],
            }
        )
        observation = json.loads(
            self.requests_path.read_text(encoding="utf-8").splitlines()[0]
        )["observation"]
        self.assertLessEqual(
            self.adapter.utf16_code_units(observation["text"]),
            self.adapter.MAX_OBSERVATION_TEXT_CHARS,
        )

        with self.assertRaises(ValueError):
            self.adapter.MegaSaverLongMemory(
                {
                    "data_root": str(self.data_root),
                    "node_command": f"{shlex.quote(sys.executable)} {shlex.quote(str(self.fake_node))} {shlex.quote(str(self.requests_path))}",
                    "token_budget": self.adapter.MAX_RECALL_TOKEN_BUDGET + 1,
                }
            )

    def test_rejects_images_outside_the_public_data_root(self) -> None:
        inside = self.data_root / "inside.png"
        outside = self.root / "outside.png"
        inside.touch()
        outside.touch()

        self.assertEqual(self.memory._checked_image_path(str(inside)), str(inside.resolve()))
        self.assertIsNone(self.memory._checked_image_path(str(outside)))

    def test_closes_piped_stdout_with_the_child_process(self) -> None:
        process = self.memory._process

        self.memory.close()

        self.assertIsNotNone(process)
        self.assertIsNotNone(process.stdout)
        self.assertTrue(process.stdout.closed)

    def test_times_out_an_unresponsive_rpc_process(self) -> None:
        slow_memory = self.adapter.MegaSaverLongMemory(
            {
                "data_root": str(self.data_root),
                "node_command": f"{shlex.quote(sys.executable)} {shlex.quote(str(self.fake_node))} {shlex.quote(str(self.requests_path))} --silent",
                "rpc_timeout_seconds": 0.01,
            }
        )

        try:
            with self.assertRaises(TimeoutError):
                slow_memory.query("Will this time out?")
        finally:
            slow_memory.close()


if __name__ == "__main__":
    unittest.main()
