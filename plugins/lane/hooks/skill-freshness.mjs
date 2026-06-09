#!/usr/bin/env node
// Lane plugin - SessionStart skill-freshness guard.
//
// Problem this solves: legacy *standalone* copies of the Lane skills can sit in
// ~/.claude/skills/<name>/ from older install methods. Personal skills OUTRANK
// plugin skills, so a stale standalone copy silently shadows the plugin - and
// `claude plugin update` can never fix it (it only rewrites ~/.claude/plugins/).
// That is exactly how users end up running an outdated flow despite a current
// plugin.
//
// This hook disables (does NOT delete) any standalone copy whose name collides
// with a plugin skill, by MOVING it into ~/.claude/skills/.lane-disabled/ so the
// skill loader stops seeing it. It is reversible, idempotent, silent on the
// common path, and always exits 0 - a hiccup must never block the session.
import {existsSync, mkdirSync, renameSync, readFileSync, readdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

// Skill names the Lane plugin owns. A standalone ~/.claude/skills/<name>/ with
// any of these names is a shadowing copy (incl. the legacy `lane-cli` name).
const LANE_SKILLS = new Set([
  'lane',
  'lane-cli',
  'wallet-setup',
  'account-setup',
  'create-intent',
  'payment-execution',
  'agentic-checkout',
]);

try {
  const skillsDir = join(homedir(), '.claude', 'skills');
  if (!existsSync(skillsDir)) process.exit(0); // nothing installed standalone

  const moved = [];
  for (const name of readdirSync(skillsDir, {withFileTypes: true})) {
    if (!name.isDirectory()) continue;
    if (name.name.startsWith('.')) continue; // skip our own .lane-disabled bucket
    if (!LANE_SKILLS.has(name.name)) continue;

    const skillMd = join(skillsDir, name.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;

    // Safety: only touch dirs that are clearly Lane's, so a user's unrelated
    // skill that happens to share a name is never moved.
    let body = '';
    try {
      body = readFileSync(skillMd, 'utf8').toLowerCase();
    } catch {
      continue;
    }
    const looksLikeLane =
      body.includes('getonlane') || body.includes('lane-cli') || body.includes('intent-mcp');
    if (!looksLikeLane) continue;

    const bucket = join(skillsDir, '.lane-disabled');
    if (!existsSync(bucket)) mkdirSync(bucket, {recursive: true});
    // Stable destination; if a prior copy is already parked there, suffix it.
    let dest = join(bucket, name.name);
    if (existsSync(dest)) dest = `${dest}-${process.pid}`;
    try {
      renameSync(join(skillsDir, name.name), dest);
      moved.push(name.name);
    } catch {
      // best-effort; never block the session
    }
  }

  if (moved.length > 0) {
    console.error(
      `[lane] disabled ${moved.length} stale standalone skill(s) that were shadowing the plugin: ${moved.join(', ')}.`
    );
    console.error(
      `[lane] the up-to-date plugin skills will now load. (backup: ~/.claude/skills/.lane-disabled/)`
    );
  }
} catch {
  // any unexpected error: stay silent, never block startup
}
process.exit(0);
