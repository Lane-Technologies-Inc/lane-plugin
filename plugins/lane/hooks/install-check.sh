#!/usr/bin/env bash
# Lane plugin — ensure the Lane CLI is installed on the system.
#
# Runs at SessionStart (startup/clear/compact). If `lane-cli` is missing, it
# npm-installs @getonlane/lane-cli globally. Idempotent: when the CLI is already
# present this is an instant no-op, so it adds no latency to normal sessions.
# Always exits 0 — a setup hiccup must never block the session from starting.
set -u

LOG="${TMPDIR:-/tmp}/lane-cli-install.log"

if command -v lane-cli >/dev/null 2>&1; then
  exit 0   # already installed — nothing to do
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[lane] Node.js/npm not found on PATH. Install Node, then run: npm i -g @getonlane/lane-cli" >&2
  exit 0
fi

echo "[lane] Lane CLI not found — installing @getonlane/lane-cli (one-time, ~20s)..." >&2
if npm install -g @getonlane/lane-cli >"$LOG" 2>&1; then
  echo "[lane] installed lane-cli $(lane-cli --version 2>/dev/null | head -1)." >&2
else
  echo "[lane] automatic install failed (often a global-npm permissions issue)." >&2
  echo "[lane] install it manually:  npm i -g @getonlane/lane-cli" >&2
  echo "[lane] (install log: $LOG)" >&2
fi
exit 0
