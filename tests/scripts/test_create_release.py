"""Run with: python3 -B -m unittest discover -s tests/scripts -v."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "create-release.py"

# Every external command is replaced, including Git, so tests cannot publish.
STUB = r'''
import json
import os
from pathlib import Path
import sys

root = Path(os.environ["RELEASE_TEST_ROOT"])
scenario = json.loads(os.environ["RELEASE_TEST_SCENARIO"])
state_path = root / "state.json"
state = json.loads(state_path.read_text()) if state_path.exists() else {}
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / "commands.jsonl").open("a") as log:
    log.write(json.dumps({"tool": tool, "args": args, "ci": os.getenv("CI"),
                          "cwd": str(Path.cwd())}) + "\n")

def save():
    state_path.write_text(json.dumps(state))

def fail():
    print("Simulated command failure", file=sys.stderr)
    sys.exit(9)

if tool == "bun":
    if args[:2] == ["pm", "version"]:
        manifest = Path("package.json")
        data = json.loads(manifest.read_text())
        version = list(map(int, data["version"].split(".")))
        index = {"major": 0, "minor": 1, "patch": 2}[args[2]]
        version[index] += 1
        version[index + 1:] = [0] * (2 - index)
        data["version"] = ".".join(map(str, version))
        manifest.write_text(json.dumps(data))
        if "--no-git-tag-version" not in args:
            state["released"] = True
            state["tag"] = "v" + data["version"]
            save()
        print("v" + data["version"])
    elif args == ["run", "test"] and scenario.get("failure") == "test":
        fail()
    elif args == ["run", "build"]:
        state["built"] = True
        save()
elif tool == "git":
    if args[0] == "status":
        if scenario.get("dirty") or (state.get("built") and scenario.get("dirty_after_checks")):
            print(" M package.json")
    elif args[0] == "symbolic-ref":
        if scenario.get("detached"):
            sys.exit(1)
        print(scenario.get("branch", "develop"))
    elif args[0] == "rev-parse":
        print("release-head" if state.get("released") else "original-head")
    elif args[0] == "remote":
        print("https://github.com/example/project.git")
    elif args[0] == "ls-remote":
        if "--heads" in args:
            print(scenario.get("remote_head", "original-head") + "\trefs/heads/develop")
        elif scenario.get("remote_tag"):
            print("tag-head\trefs/tags/v1.2.4")
    elif args[0] == "show-ref":
        sys.exit(0 if scenario.get("local_tag") else 1)
    elif args[0] == "branch":
        print("changed-branch" if scenario.get("changed_branch") else "develop")
    elif args[0] == "push":
        if scenario.get("failure") == "push":
            fail()
        state["pushed"] = True
        save()
    else:
        raise AssertionError(args)
elif tool == "gh":
    if args[:2] == ["repo", "view"]:
        if "--jq" in args:
            print("https://github.com/example/project\tdevelop")
        else:
            print(json.dumps({"url": "https://github.com/example/project",
                              "defaultBranchRef": {"name": "develop"}}))
    elif args[:2] == ["release", "create"]:
        if scenario.get("failure") == "release":
            fail()
        state["published"] = True
        save()
    else:
        raise AssertionError(args)
'''


class CreateReleaseTests(unittest.TestCase):
    def run_release(self, *args, **scenario):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / "scripts").mkdir()
        shutil.copy2(SCRIPT, root / "scripts" / SCRIPT.name)
        manifest = root / "package.json"
        manifest.write_text('{"name":"release-test","version":"1.2.3"}\n')
        original_manifest = manifest.read_bytes()
        binary_dir = root / "bin"
        binary_dir.mkdir()
        for tool in ("bun", "git", "gh"):
            executable = binary_dir / tool
            executable.write_text(f"#!{sys.executable}\n{STUB}")
            executable.chmod(0o755)
        environment = dict(os.environ)
        environment.pop("CI", None)
        environment.update(
            PATH=str(binary_dir) + os.pathsep + environment.get("PATH", ""),
            RELEASE_TEST_ROOT=str(root),
            RELEASE_TEST_SCENARIO=json.dumps(scenario),
        )
        result = subprocess.run(
            [sys.executable, str(root / "scripts" / SCRIPT.name), *args],
            cwd=binary_dir, env=environment, text=True, capture_output=True,
        )
        log = root / "commands.jsonl"
        commands = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        state_path = root / "state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        return result, commands, state, manifest, original_manifest

    def test_dry_run_previews_each_bump_without_changing_checkout(self):
        for args, version in ((["--dry-run"], "1.2.4"),
                              (["minor", "--dry-run"], "1.3.0"),
                              (["--dry-run", "major"], "2.0.0")):
            with self.subTest(args=args):
                result, commands, state, manifest, original = self.run_release(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Release: v" + version, result.stdout)
                self.assertEqual(manifest.read_bytes(), original)
                self.assertEqual([command["tool"] for command in commands], ["bun"])
                self.assertIn("--ignore-scripts", commands[0]["args"])
                self.assertFalse(Path(commands[0]["cwd"]).exists())
                self.assertEqual(state, {})

    def test_help_and_invalid_arguments_do_not_run_commands(self):
        for args, succeeds in ((["--help"], True), (["patch", "minor"], False),
                               (["--unknown"], False)):
            with self.subTest(args=args):
                result, commands, *_ = self.run_release(*args)
                self.assertEqual(result.returncode == 0, succeeds)
                self.assertEqual(commands, [])

    def test_failed_preconditions_and_checks_do_not_bump_or_publish(self):
        for scenario in ({"dirty": True}, {"branch": "feature"}, {"detached": True},
                         {"remote_head": "different-head"}, {"local_tag": True},
                         {"remote_tag": True}, {"failure": "test"},
                         {"dirty_after_checks": True}, {"changed_branch": True}):
            with self.subTest(scenario=scenario):
                result, commands, state, manifest, original = self.run_release(**scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(manifest.read_bytes(), original)
                self.assertFalse(state.get("released"))
                self.assertFalse(any(command["args"][0] == "push" for command in commands))
                self.assertNotIn("Publishing interrupted", result.stderr)

    def test_success_runs_checks_then_bumps_and_publishes(self):
        result, commands, state, manifest, _ = self.run_release("minor")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(manifest.read_text())["version"], "1.3.0")
        bun = [command for command in commands if command["tool"] == "bun"]
        self.assertEqual([command["args"][:2] for command in bun[1:]], [
            ["install", "--frozen-lockfile"], ["run", "typecheck"],
            ["run", "test"], ["run", "build"], ["pm", "version"],
        ])
        self.assertEqual([command["ci"] for command in bun[1:]], [None, None, "true", None, None])
        self.assertEqual(commands[-2]["args"], [
            "push", "--atomic", "--no-follow-tags", "origin",
            "release-head:refs/heads/develop", "refs/tags/v1.3.0:refs/tags/v1.3.0",
        ])
        self.assertEqual(commands[-1]["args"][:3], ["release", "create", "v1.3.0"])
        self.assertIn("--verify-tag", commands[-1]["args"])
        self.assertIn("--generate-notes", commands[-1]["args"])
        self.assertTrue(state["published"])
        self.assertIn("Published v1.3.0", result.stdout)

    def test_publishing_failures_keep_release_and_print_recovery(self):
        for failure in ("push", "release"):
            with self.subTest(failure=failure):
                result, commands, state, manifest, _ = self.run_release(failure=failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(json.loads(manifest.read_text())["version"], "1.2.4")
                self.assertEqual(state["tag"], "v1.2.4")
                self.assertTrue(state["released"])
                self.assertEqual(bool(state.get("pushed")), failure == "release")
                self.assertFalse(state.get("published"))
                self.assertIn("do not bump again", result.stderr)
                self.assertIn("git push --atomic --no-follow-tags origin", result.stderr)
                self.assertIn("release-head:refs/heads/develop", result.stderr)
                self.assertIn("gh release view v1.2.4 --repo https://github.com/example/project", result.stderr)
                self.assertIn("gh release create v1.2.4", result.stderr)


if __name__ == "__main__":
    unittest.main()
