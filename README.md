# Lane for Claude Code

**The official Lane plugin for Claude Code**, published by
[Lane Technologies](https://getonlane.com). It turns your agent into an
agentic-commerce buyer: it drafts a purchase intent, you approve it with a
passkey, and Lane's `checkout-mcp` autonomously completes the purchase at the
merchant. Bundles the Lane skills, the `intent-mcp` + `checkout-mcp` servers,
and an auto-installer for the `@getonlane/lane-cli` binary.

> **Provenance.** This repo — `github.com/Lane-Technologies-Inc/lane-plugin` —
> is Lane's official distribution for the plugin. It is not listed in any public
> plugin directory; you install it by pointing Claude Code straight at this
> repo. `/plugin marketplace add` simply reads the manifest from here — it does
> not publish anything or pull from an app store.

This repository is also a Claude Code **plugin marketplace** named `lane-cli`
containing one plugin, `lane`.

## Install

### Option A — from this repo (recommended)

```text
/plugin marketplace add Lane-Technologies-Inc/lane-plugin
/plugin install lane@lane-cli
```

(Use the repo URL or a local clone path instead of the `owner/repo` shorthand
if you're hosting it elsewhere: `/plugin marketplace add /path/to/lane-plugin`.)

### Option B — from a downloaded copy

Unzip `lane-plugin.zip`, then either:

```text
/plugin marketplace add /absolute/path/to/lane-plugin
/plugin install lane@lane-cli
```

or load the plugin directly without a marketplace:

```bash
claude --plugin-dir /absolute/path/to/lane-plugin/plugins/lane
```

## After install

1. **Leave the API key blank at install.** The MCP servers authenticate with
   your Lane API key, but you don't enter it by hand. When the agent runs
   `lane-cli init` (browser login), the account-setup flow auto-copies the key
   from `~/.lane/config.json` into the plugin config, then asks you to
   `/reload-plugins`. This keeps the plugin and the CLI on the **same Lane
   account** — set the key manually only to point at a different account.
2. The `@getonlane/lane-cli` binary installs automatically on the first session
   (needs Node/npm on PATH). Works on macOS, Linux, and Windows — a Node
   dispatcher runs the matching install script (`.sh` / `.ps1`).
3. Say what you want to buy. The agent handles login, key sync, wallet setup,
   intent approval (one passkey tap), and checkout.

## Endpoints

The intent-mcp and checkout-mcp URLs are baked into the plugin manifest and
point at Lane **staging** (the only environment deployed today):
`https://mcp-staging.aws.getonlane.com/intent/mcp` and `/checkout/mcp`. There is
nothing to configure at install — the API key is filled in automatically after
`lane-cli init` (see step 1 above). When production launches,
swap the `mcpServers` URLs in `plugins/lane/.claude-plugin/plugin.json` to
`https://mcp.getonlane.com/{intent,checkout}/mcp`.

## Trust & provenance

On install, Claude Code asks you to approve two things this plugin ships — both
expected, and both defined in plain sight in this repo:

- a **SessionStart hook** (`plugins/lane/hooks/install-check.mjs`) that installs
  the `@getonlane/lane-cli` binary via npm, and
- two **MCP servers** (`intent-mcp`, `checkout-mcp`, declared in
  `plugins/lane/.claude-plugin/plugin.json`) that make authenticated calls to
  Lane's hosted endpoints.

Because the plugin handles real payment credentials, review both before
approving if you like — that's the whole point of installing from Lane's own
repository rather than a third party.

## What's bundled

```
plugins/lane/
├── .claude-plugin/plugin.json   # manifest: userConfig + inline MCP servers
├── skills/                      # lane router + setup/payment sub-skills
├── hooks/                       # SessionStart: auto-install lane-cli
└── README.md
```

## Security

Raw card numbers never reach Lane servers — cards are tokenized via
[VGS](https://www.verygoodsecurity.com/) (aliases only, never the PAN), payment
credentials are single-use, and every agent-initiated payment is gated by a
passkey approval. Full details and how to report a vulnerability:
[`SECURITY.md`](./SECURITY.md).

## License

MIT
