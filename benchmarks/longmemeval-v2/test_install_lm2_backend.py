from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


BENCHMARK_DIR = Path(__file__).parent
INSTALLER = BENCHMARK_DIR / "install-lm2-backend.mjs"
BACKEND = BENCHMARK_DIR / "megasaver_lm2_hybrid.py"
PROTECTED = [
    "evaluation/harness.py",
    "leaderboard/build_submission_step_1_single_operating_point.py",
    "leaderboard/build_submission_step_2_build_package.py",
]


def file_digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


class InstallLm2BackendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        official_root = os.environ.get("LONGMEMEVAL_V2_ROOT")
        if not official_root:
            raise unittest.SkipTest("LONGMEMEVAL_V2_ROOT must name the pinned official checkout")
        cls.official_root = Path(official_root).resolve()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.checkout = Path(self.temporary.name) / "official"
        shutil.copytree(self.official_root, self.checkout, symlinks=True)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def install(self, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "node",
                str(INSTALLER),
                "--checkout",
                str(self.checkout),
                "--backend",
                str(BACKEND),
            ],
            text=True,
            capture_output=True,
            check=check,
        )

    def test_installs_only_allowlisted_bytes_and_is_idempotent(self) -> None:
        protected_before = {name: file_digest(self.checkout / name) for name in PROTECTED}

        first = json.loads(self.install().stdout)
        second = json.loads(self.install().stdout)

        self.assertEqual(first["preInstallState"], "baseline")
        self.assertEqual(second["preInstallState"], "installed")
        self.assertEqual(first["officialCommit"], "6f020ac2fc3275e46c706d3406e02c3ed79b7be2")
        self.assertEqual(
            subprocess.check_output(
                ["git", "status", "--porcelain"], cwd=self.checkout, text=True
            ).splitlines(),
            [
                " M memory_modules/memory.py",
                "?? memory_modules/megasaver_lm2_hybrid.py",
            ],
        )
        self.assertEqual(
            protected_before,
            {name: file_digest(self.checkout / name) for name in PROTECTED},
        )
        self.assertEqual(
            file_digest(self.checkout / "memory_modules/megasaver_lm2_hybrid.py"),
            file_digest(BACKEND),
        )
        memory_source = (self.checkout / "memory_modules/memory.py").read_text()
        self.assertEqual(memory_source.count("MEGASAVER_LM2_BACKEND_IMPORT"), 1)
        import_smoke = """
import sys, types
for module_name, class_name in {
    'no_retrieval': 'NoRetrievalMemory', 'codex': 'CodexMemory',
    'agentrunbook_c': 'AgentRunbookC', 'agentrunbook_c_v2': 'AgentRunbookCV2',
    'agentrunbook_r': 'AgentRunbookR', 'rag': 'RagMemory',
}.items():
    module = types.ModuleType(f'memory_modules.{module_name}')
    setattr(module, class_name, type(class_name, (), {}))
    sys.modules[module.__name__] = module
from memory_modules.memory import MEMORY_TYPES
assert 'megasaver_lm2_hybrid' in MEMORY_TYPES
"""
        subprocess.run(
            [sys.executable, "-c", import_smoke],
            cwd=self.checkout,
            env={**os.environ, "PYTHONPATH": str(self.checkout)},
            check=True,
        )

    def test_rejects_extra_dirty_or_protected_modified_checkout(self) -> None:
        extra = self.checkout / "unrelated.txt"
        extra.write_text("dirty", encoding="utf-8")
        failed = self.install(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse((self.checkout / "memory_modules/megasaver_lm2_hybrid.py").exists())

        extra.unlink()
        harness = self.checkout / "evaluation/harness.py"
        harness.write_text(harness.read_text() + "\n# tampered\n", encoding="utf-8")
        failed = self.install(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertFalse((self.checkout / "memory_modules/megasaver_lm2_hybrid.py").exists())


if __name__ == "__main__":
    unittest.main()
