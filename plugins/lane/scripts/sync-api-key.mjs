#!/usr/bin/env node
// Lane plugin — sync the CLI's API key into the plugin config.
//
// Why: the intent-mcp / checkout-mcp servers authenticate with
// `Authorization: Bearer ${user_config.lane_api_key}`. If that value differs
// from the key the Lane CLI logged in with (~/.lane/config.json → apiKey), the
// MCP servers act as a DIFFERENT Lane account than the user's wallet/cards —
// so the approval page reports "no agentic card" even after enrollment.
//
// This copies ~/.lane/config.json:apiKey into Claude Code's plugin config at
// ~/.claude/settings.json → pluginConfigs[<id>].options.lane_api_key, so both
// sides use one account. Run it after `lane-cli init` succeeds. The change
// takes effect after `/reload-plugins` (MCP servers re-read headers on connect).
//
// Idempotent and non-destructive: it only touches the one nested key and
// preserves the rest of settings.json. Always exits 0 (prints guidance on any
// problem) so it never blocks the setup flow.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const CONFIG = join(homedir(), '.lane', 'config.json');
const SETTINGS = join(homedir(), '.claude', 'settings.json');

const done = (msg) => { console.log(msg); process.exit(0); };

if (!existsSync(CONFIG)) {
  done('[lane] ~/.lane/config.json not found — run `lane-cli init` first, then re-run this sync.');
}

let apiKey = '';
try {
  apiKey = (JSON.parse(readFileSync(CONFIG, 'utf8')).apiKey || '').trim();
} catch (e) {
  done(`[lane] could not parse ~/.lane/config.json (${e.message}); skipping key sync.`);
}
if (!apiKey) {
  done('[lane] ~/.lane/config.json has no apiKey yet — finish `lane-cli init` (browser login), then re-run.');
}

let settings = {};
if (existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
  } catch (e) {
    done(`[lane] ~/.claude/settings.json is present but unparseable (${e.message}); not overwriting. Set the key via /plugin → configure → lane.`);
  }
}

// Resolve the plugin id Claude Code keys config under. It matches the
// enabledPlugins id (name@marketplace), e.g. "lane@lane-cli". Prefer whatever
// the user already has enabled; fall back to the canonical id.
const enabled = settings.enabledPlugins && typeof settings.enabledPlugins === 'object'
  ? Object.keys(settings.enabledPlugins) : [];
const pluginId =
  enabled.find(k => /^lane@/.test(k)) ||
  enabled.find(k => k === 'lane' || /(^|[@/])lane([@/]|$)/.test(k)) ||
  'lane@lane-cli';

settings.pluginConfigs = settings.pluginConfigs || {};
settings.pluginConfigs[pluginId] = settings.pluginConfigs[pluginId] || {};
settings.pluginConfigs[pluginId].options = settings.pluginConfigs[pluginId].options || {};

const prev = settings.pluginConfigs[pluginId].options.lane_api_key;
if (prev === apiKey) {
  done(`[lane] plugin key already in sync with the CLI (account unchanged). No write needed.`);
}

settings.pluginConfigs[pluginId].options.lane_api_key = apiKey;
writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');

const suffix = apiKey.length > 6 ? '…' + apiKey.slice(-6) : '(set)';
console.log(`[lane] wrote CLI apiKey (${suffix}) → ~/.claude/settings.json pluginConfigs["${pluginId}"].options.lane_api_key`);
console.log('[lane] run /reload-plugins so intent-mcp + checkout-mcp reconnect with your account key.');
process.exit(0);
