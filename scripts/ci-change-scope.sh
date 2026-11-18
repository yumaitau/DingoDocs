#!/usr/bin/env bash
# Decides whether a CI job needs to do its work. Writes `full=true|false` to
# $GITHUB_OUTPUT.
#
# Only a pull request whose every changed path is Markdown skips. Pushes,
# manual runs, schedules, an empty or unreadable diff, or any other path
# (including images under docs/, which the app imports) run in full. Jobs keep
# their names and still report a status, so required checks are unaffected.
#
# On pull_request events actions/checkout checks out GitHub's merge commit,
# whose first parent is the base branch, so the job needs fetch-depth: 2.
set -euo pipefail

decide() {
  if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
    echo "Event ${GITHUB_EVENT_NAME:-unknown}: running in full." >&2
    echo true
    return
  fi
  local files
  if ! files=$(git diff --no-renames --name-only HEAD^1 HEAD); then
    echo "Could not diff against the base branch: running in full." >&2
    echo true
    return
  fi
  if [[ -z "$files" ]]; then
    echo "No changed files found: running in full." >&2
    echo true
    return
  fi
  if grep -qvE '\.mdx?$' <<<"$files"; then
    echo "Non-Markdown changes found: running in full." >&2
    echo true
  else
    echo "Only Markdown changed: skipping." >&2
    echo false
  fi
}

echo "full=$(decide)" >> "${GITHUB_OUTPUT:-/dev/stdout}"
