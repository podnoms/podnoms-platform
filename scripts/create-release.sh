#!/usr/bin/env bash
set -euo pipefail

usage() { echo 'Usage: scripts/create-release.sh [patch|minor|major] [--dry-run]'; }
fail() { echo "Error: $*" >&2; exit 1; }

bump=
dry_run=false
for argument in "$@"; do
  case "$argument" in
    --help|-h) usage; exit 0 ;;
    --dry-run) dry_run=true ;;
    patch|minor|major)
      [[ -z "$bump" ]] || fail 'Supply only one bump type.'
      bump=$argument ;;
    *) usage >&2; exit 1 ;;
  esac
done
bump=${bump:-patch}
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

# Let Bun calculate the version on a temporary copy, without hooks or Git writes.
preview=$(mktemp -d)
trap 'rm -rf -- "$preview"' EXIT
cp package.json "$preview/package.json"
tag=$(cd "$preview" && bun pm version "$bump" --no-git-tag-version --ignore-scripts)
printf 'Release: %s\n' "$tag"
if "$dry_run"; then
  echo 'Would run checks, bump with bun pm version, push the branch/tag, and create a GitHub release.'
  exit 0
fi

[[ -z "$(git status --porcelain)" ]] || fail 'Commit or stash all changes before releasing.'
branch=$(git symbolic-ref --quiet --short HEAD) || fail 'Check out the default branch first.'
head=$(git rev-parse HEAD)
remote=$(git remote get-url --push --all origin)
[[ "$remote" != *$'\n'* ]] || fail 'origin must have exactly one push URL.'
metadata=$(gh repo view "$remote" --json url,defaultBranchRef \
  --jq '[.url, .defaultBranchRef.name] | @tsv')
IFS=$'\t' read -r repository default_branch <<< "$metadata"
[[ "$branch" == "$default_branch" ]] || fail "Release from the default branch: $default_branch."
remote_head=$(git ls-remote --exit-code --heads "$remote" "refs/heads/$branch")
[[ "${remote_head%%$'\t'*}" == "$head" ]] || fail 'Synchronize and push the default branch first.'
if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "Tag $tag already exists locally."
fi
remote_tag=$(git ls-remote --tags "$remote" "refs/tags/$tag")
[[ -z "$remote_tag" ]] || fail "Tag $tag already exists on origin."

bun install --frozen-lockfile
bun run typecheck
CI=true bun run test
bun run build
[[ -z "$(git status --porcelain)" ]] || fail 'Checks changed tracked files; review and commit them first.'
[[ "$(git rev-parse HEAD)" == "$head" && "$(git branch --show-current)" == "$branch" ]] ||
  fail 'The checkout changed during checks; start again.'

# Bun updates package.json and creates the release commit and annotated tag.
bun pm version "$bump" --message 'chore(release): v%s'
release_commit=$(git rev-parse HEAD)

# Keep the commit/tag if publishing fails, since a network error can occur after success.
recover() {
  echo 'Publishing interrupted. Inspect the remote before retrying these steps; do not bump again:' >&2
  printf '  git push --atomic --no-follow-tags origin %q %q\n' \
    "$release_commit:refs/heads/$branch" "refs/tags/$tag:refs/tags/$tag" >&2
  printf '  gh release view %q --repo %q\n' "$tag" "$repository" >&2
  printf '  gh release create %q --repo %q --verify-tag --generate-notes --title %q\n' \
    "$tag" "$repository" "$tag" >&2
}
trap recover ERR

git push --atomic --no-follow-tags origin "$release_commit:refs/heads/$branch" "refs/tags/$tag:refs/tags/$tag"
gh release create "$tag" --repo "$repository" --verify-tag --generate-notes --title "$tag"
trap - ERR
printf 'Published %s. The tag also triggers the GHCR image build.\n' "$tag"
