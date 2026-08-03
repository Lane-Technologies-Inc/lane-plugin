#!/usr/bin/env node
// Lane plugin - cross-platform SessionStart installer (dispatcher).
//
// Ensures the `@getonlane/lane-cli` binary is installed. Runs on every OS:
// it short-circuits when lane-cli is already present, otherwise routes to the
// OS-specific worker (install-check.ps1 on Windows, install-check.sh on
// macOS/Linux). Node is already required here because the install uses npm.
// Always exits 0 so a setup hiccup never blocks the session.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';

// Already installed? -> fast no-op (no shell spawned on the common path).
const probe = spawnSync(isWin ? 'where' : 'which', ['lane-cli'], {stdio: 'ignore'});
if (probe.status === 0) process.exit(0);

if (isWin) {
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'install-check.ps1')],
    {stdio: 'inherit'}
  );
} else {
  spawnSync('bash', [join(here, 'install-check.sh')], {stdio: 'inherit'});
}
process.exit(0);
