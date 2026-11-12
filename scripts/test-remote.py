#!/usr/bin/env python3
"""Exercise Make's remote command boundary and rsync filters without SSH."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lgtm-remote-test-")
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.local, self.remote, tools = (base / name for name in ("local", "remote", "bin"))
        for folder in (self.local / "scripts", self.remote, tools):
            folder.mkdir(parents=True)
        for name in ("Makefile", ".gitignore", "scripts/remote.sh"):
            shutil.copy2(ROOT / name, self.local / name)
        subprocess.run(["git", "init", "-q", str(self.local)], check=True)
        subprocess.run(["git", "-C", str(self.local), "-c", "user.name=Test", "-c", "user.email=test@example.test",
                        "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "Fixture"], check=True)
        # Keep the production rsync arguments, replacing only the SSH destination
        # with a local directory. No host is contacted by this test.
        (tools / "rsync").write_text('''#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
pos = args.index('-e')
del args[pos:pos+2]
args[-1] = os.environ['TEST_REMOTE'] + '/'
raise SystemExit(subprocess.run(['/usr/bin/rsync', *args]).returncode)
''')
        # Capture the exact source sent to SSH and execute its final in_copy
        # call using a local stand-in for the already-tested resource limiter.
        (tools / "ssh").write_text('''#!/usr/bin/env python3
import os, subprocess, sys
source = sys.stdin.read()
calls = [line for line in source.splitlines() if line.startswith('lgtm_limited ')]
if not calls:
    raise SystemExit(0)
setup = 'set -euo pipefail\\ncd "$TEST_REMOTE"\\nlgtm_limited() { bash -c "$1"; }\\n'
raise SystemExit(subprocess.run(['bash', '-c', setup + calls[-1]]).returncode)
''')
        for tool in tools.iterdir():
            tool.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{tools}:/usr/bin:/bin", "TEST_REMOTE": str(self.remote)}

    def run_remote(self, command):
        return subprocess.run(["make", "remote-run", f"CMD={command}"], cwd=self.local,
                              env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def test_compound_command_stays_remote_after_sync(self):
        (self.local / "copied").write_text("fresh copy")
        command = '''test "$(cat copied)" = 'fresh copy' && printf '%s\\n' "quoted 'value'" > first; printf '%s' "$PWD" > where
printf '%s' 'line two' > second'''
        result = self.run_remote(command)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.remote / "where").read_text(), str(self.remote))
        self.assertEqual((self.remote / "first").read_text(), "quoted 'value'\n")
        self.assertEqual((self.remote / "second").read_text(), "line two")
        self.assertFalse((self.local / "where").exists())
        self.assertFalse((self.local / "second").exists())

    def test_failed_remote_command_propagates_and_short_circuits(self):
        result = self.run_remote("exit 17 && touch should-not-exist")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Error 17", result.stderr)
        self.assertFalse((self.remote / "should-not-exist").exists())
        self.assertFalse((self.local / "should-not-exist").exists())

    def test_shell_operators_cannot_run_a_tail_locally(self):
        result = self.run_remote("true && pwd > where; pwd > later")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.remote / "where").read_text().strip(), str(self.remote))
        self.assertEqual((self.remote / "later").read_text().strip(), str(self.remote))
        self.assertFalse((self.local / "where").exists())
        self.assertFalse((self.local / "later").exists())

    def test_env_files_are_excluded_even_if_tracked(self):
        for prefix in (self.local, self.local / "nested"):
            prefix.mkdir(exist_ok=True)
            for name in (".env", ".env.local", ".env.example", "ordinary"):
                (prefix / name).write_text("synthetic fixture")
        subprocess.run(["git", "add", "-f", "."], cwd=self.local, check=True)
        result = self.run_remote("true")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for prefix in (Path(), Path("nested")):
            for name in (".env", ".env.local"):
                self.assertFalse((self.remote / prefix / name).exists(), str(prefix / name))
                ignored = subprocess.run(["git", "check-ignore", "--no-index", str(prefix / name)],
                                         cwd=self.local, stdout=subprocess.PIPE)
                self.assertEqual(ignored.returncode, 0)
            self.assertTrue((self.remote / prefix / ".env.example").exists())
            self.assertTrue((self.remote / prefix / "ordinary").exists())


if __name__ == "__main__":
    unittest.main()
