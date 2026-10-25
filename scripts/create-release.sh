#!/usr/bin/env python3
"""Check, version, and publish a release with Bun and the GitHub CLI."""

import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent


def run(*command, cwd=ROOT, check=True, **kwargs):
    return subprocess.run(command, cwd=cwd, check=check, text=True, **kwargs)


def output(*command, **kwargs):
    return run(*command, stdout=subprocess.PIPE, **kwargs).stdout.rstrip("\n")


def preview_version(bump):
    # Let Bun calculate the version without hooks or Git writes.
    with tempfile.TemporaryDirectory(prefix="podnoms-release-") as preview:
        shutil.copyfile(ROOT / "package.json", Path(preview) / "package.json")
        return output(
            "bun", "pm", "version", bump,
            "--no-git-tag-version", "--ignore-scripts", cwd=preview,
        )


def recovery_commands(push_command, tag, repository, release_command):
    print(
        "Publishing interrupted. Inspect the remote before retrying these steps; "
        "do not bump again:",
        file=sys.stderr,
    )
    for command in (
        push_command,
        ["gh", "release", "view", tag, "--repo", repository],
        release_command,
    ):
        print(f"  {shlex.join(command)}", file=sys.stderr)


def release(bump, dry_run):
    tag = preview_version(bump)
    print(f"Release: {tag}", flush=True)
    if dry_run:
        print(
            "Would run checks, bump with bun pm version, push the branch/tag, "
            "and create a GitHub release."
        )
        return

    if output("git", "status", "--porcelain"):
        raise RuntimeError("Commit or stash all changes before releasing.")
    branch_result = run(
        "git", "symbolic-ref", "--quiet", "--short", "HEAD",
        check=False, stdout=subprocess.PIPE,
    )
    if branch_result.returncode:
        raise RuntimeError("Check out the default branch first.")
    branch = branch_result.stdout.rstrip("\n")
    head = output("git", "rev-parse", "HEAD")
    remote = output("git", "remote", "get-url", "--push", "--all", "origin")
    if not remote or "\n" in remote:
        raise RuntimeError("origin must have exactly one push URL.")
    metadata = output(
        "gh", "repo", "view", remote, "--json", "url,defaultBranchRef",
        "--jq", "[.url, .defaultBranchRef.name] | @tsv",
    )
    repository, separator, default_branch = metadata.partition("\t")
    if not separator or not repository or not default_branch:
        raise RuntimeError("Could not determine the repository and default branch.")
    if branch != default_branch:
        raise RuntimeError(f"Release from the default branch: {default_branch}.")
    # Local commits can be included in the release push, provided they contain
    # the remote branch's latest history. Fetch from the actual push destination.
    run("git", "fetch", "--no-tags", remote, f"refs/heads/{branch}")
    remote_head = output("git", "rev-parse", "--verify", "FETCH_HEAD")
    ancestry = run(
        "git", "merge-base", "--is-ancestor", remote_head, head, check=False,
    )
    if ancestry.returncode == 1:
        raise RuntimeError(
            "The default branch is behind or has diverged from origin. "
            "Merge or rebase the remote changes before releasing."
        )
    ancestry.check_returncode()
    if remote_head != head:
        print("Local commits will be pushed with the release.", flush=True)
    local_tag = run(
        "git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}", check=False,
    )
    if local_tag.returncode == 0:
        raise RuntimeError(f"Tag {tag} already exists locally.")
    if local_tag.returncode != 1:
        local_tag.check_returncode()
    if output("git", "ls-remote", "--tags", remote, f"refs/tags/{tag}"):
        raise RuntimeError(f"Tag {tag} already exists on origin.")

    run("bun", "install", "--frozen-lockfile")
    run("bun", "run", "typecheck")
    run("bun", "run", "test", env={**os.environ, "CI": "true"})
    run("bun", "run", "build")
    if output("git", "status", "--porcelain"):
        raise RuntimeError("Checks changed tracked files; review and commit them first.")
    if (
        output("git", "rev-parse", "HEAD") != head
        or output("git", "branch", "--show-current") != branch
    ):
        raise RuntimeError("The checkout changed during checks; start again.")

    # Bun updates package.json and creates the release commit and annotated tag.
    run("bun", "pm", "version", bump, "--message", "chore(release): v%s")
    release_commit = output("git", "rev-parse", "HEAD")
    push_command = [
        "git", "push", "--atomic", "--no-follow-tags", "origin",
        f"{release_commit}:refs/heads/{branch}", f"refs/tags/{tag}:refs/tags/{tag}",
    ]
    release_command = [
        "gh", "release", "create", tag, "--repo", repository,
        "--verify-tag", "--generate-notes", "--title", tag,
    ]
    # Keep the commit/tag: a network error can occur after publishing succeeds.
    try:
        run(*push_command)
        run(*release_command)
    except (subprocess.CalledProcessError, OSError, KeyboardInterrupt):
        recovery_commands(push_command, tag, repository, release_command)
        raise
    print(f"Published {tag}. The tag also triggers the GHCR image build.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "bump", nargs="?", choices=("patch", "minor", "major"), default="patch",
        help="version component to bump (default: patch)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="preview the version and release steps",
    )
    args = parser.parse_args()
    try:
        release(args.bump, args.dry_run)
    except subprocess.CalledProcessError as error:
        print(
            f"Error: {shlex.join(error.cmd)} exited with status {error.returncode}.",
            file=sys.stderr,
        )
        return error.returncode if error.returncode > 0 else 128 - error.returncode
    except (OSError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
