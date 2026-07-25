from __future__ import annotations

import argparse
from hashlib import sha256
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest


class OfficialEvidenceContractTest(unittest.TestCase):
    def test_integer_argument_fixture_matches_pinned_argparse(self) -> None:
        root_value = os.environ.get("LONGMEMEVAL_V2_ROOT")
        if not root_value:
            self.skipTest("LONGMEMEVAL_V2_ROOT must name the pinned official checkout")
        source = Path(root_value).resolve() / "evaluation/harness.py"
        fixture_path = Path(__file__).parents[2] / "packages/long-memory/test/fixtures/lm2-pinned-integer-arguments.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), fixture["harnessFileSha256"])
        source_text = source.read_text(encoding="utf-8")
        self.assertIn(f'parser.add_argument("{fixture["flag"]}", type=int,', source_text)
        parser = argparse.ArgumentParser(exit_on_error=False)
        parser.add_argument(fixture["flag"], type=int)
        for case in fixture["cases"]:
            with self.subTest(value=case["value"]):
                try:
                    parser.parse_args([fixture["flag"], case["value"]])
                    accepted = True
                except argparse.ArgumentError:
                    accepted = False
                self.assertEqual(accepted, case["pythonArgparseAccepts"])

    def test_pinned_combine_timing_omits_local_percentiles(self) -> None:
        root_value = os.environ.get("LONGMEMEVAL_V2_ROOT")
        if not root_value:
            self.skipTest("LONGMEMEVAL_V2_ROOT must name the pinned official checkout")
        root = Path(root_value).resolve()
        self.assertEqual(
            subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
            "6f020ac2fc3275e46c706d3406e02c3ed79b7be2",
        )
        source = root / "leaderboard/combine_aggregated_metrics.py"
        fixture_path = Path(__file__).parents[2] / "packages/long-memory/test/fixtures/lm2-pinned-combine-timing.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), fixture["combineFileSha256"])
        spec = importlib.util.spec_from_file_location("pinned_combine_metrics", source)
        if spec is None or spec.loader is None:
            raise RuntimeError("Unable to load pinned combine metrics")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        actual = module.combine_timing(
            fixture["left"]["summary"],
            fixture["right"]["summary"],
            fixture["left"]["count"],
            fixture["right"]["count"],
        )
        self.assertEqual(actual, fixture["expected"])
        floating = fixture["floatingOrder"]
        floating_actual = module.combine_timing(
            floating["left"]["summary"],
            floating["right"]["summary"],
            floating["left"]["count"],
            floating["right"]["count"],
        )
        self.assertEqual(floating_actual, floating["expected"])


if __name__ == "__main__":
    unittest.main()
