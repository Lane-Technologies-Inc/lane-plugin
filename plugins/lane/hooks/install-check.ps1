# Lane plugin - ensure the Lane CLI is installed on the system (Windows).
#
# Invoked by the SessionStart dispatcher on Windows. Installs
# @getonlane/lane-cli globally via npm if it's missing. Idempotent and
# non-blocking-by-intent: always exits 0 so it never stops the session.
$ErrorActionPreference = 'SilentlyContinue'

if (Get-Command lane-cli -ErrorAction SilentlyContinue) {
  exit 0   # already installed - nothing to do
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  [Console]::Error.WriteLine('[lane] Node.js/npm not found on PATH. Install Node, then run: npm i -g @getonlane/lane-cli')
  exit 0
}

[Console]::Error.WriteLine('[lane] Lane CLI not found - installing @getonlane/lane-cli (one-time, ~20s)...')
$log = Join-Path $env:TEMP 'lane-cli-install.log'
& npm install -g @getonlane/lane-cli *> $log

if (Get-Command lane-cli -ErrorAction SilentlyContinue) {
  $v = (& lane-cli --version 2>$null | Select-Object -First 1)
  [Console]::Error.WriteLine("[lane] installed lane-cli $v.")
} else {
  [Console]::Error.WriteLine('[lane] automatic install failed (often a global-npm permissions issue).')
  [Console]::Error.WriteLine('[lane] install it manually:  npm i -g @getonlane/lane-cli')
  [Console]::Error.WriteLine("[lane] (install log: $log)")
}
exit 0
