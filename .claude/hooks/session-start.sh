#!/bin/bash
# Installs npm dependencies at the start of Claude Code cloud sessions so typecheck, tests and
# build work straight away. Skips the install when nothing that decides what gets installed changed.
set -euo pipefail

# Local machines manage their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  # Delete the old hashes first, so a failed install runs again next time.
  rm -f "$hashes"

  # --no-save keeps package-lock.json untouched. npm's output goes to stderr so it stays out of
  # the session context.
  if ! npm install --no-audit --no-fund --no-save >&2; then
    echo "session-start: npm install failed." >&2
    echo "session-start: xlsx is downloaded from cdn.sheetjs.com, not the npm registry. If the log above" >&2
    echo "session-start: shows a 403 for that host, add cdn.sheetjs.com to the cloud environment's allowed domains." >&2
    exit 1
  fi

  sha256sum .claude/hooks/session-start.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
fi
