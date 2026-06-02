# Security & data handling

This plugin lets a Claude Code agent authorize and execute payments on the
user's **own** card, through [Lane](https://getonlane.com). It is designed so
that raw card data never touches Lane's servers.

## What the plugin executes on your machine

- **A SessionStart hook** (`plugins/lane/hooks/install-check.mjs`) that installs
  the `@getonlane/lane-cli` binary from npm if it isn't already on your PATH. It
  installs nothing else and runs no other code at startup.
- **Two hosted MCP servers** (`intent-mcp`, `checkout-mcp`) reached over HTTPS
  and authenticated with your Lane API key (`Authorization: Bearer`). These are
  not local processes — they run on Lane's infrastructure. Their URLs are
  declared in plain sight in `plugins/lane/.claude-plugin/plugin.json`.

## Card data

- **Raw card numbers (PANs) never reach Lane servers.** Cards are entered into a
  hosted [VGS](https://www.verygoodsecurity.com/) field and tokenized; Lane only
  ever handles aliases (`tok_*`), never the PAN. VGS is the token requestor, so
  the cardholder data environment stays outside Lane's PCI scope.
- **Payment credentials are single-use.** The network token / cryptogram minted
  for a purchase is scoped to one approved purchase intent and is not reusable.
  Treat it as a one-time secret; do not echo it into long-lived chat history.
- **Every agent-initiated payment is gated by an explicit user approval** — a
  FIDO passkey / biometric ceremony in the browser. The agent cannot mint a
  credential without that human approval.

## Authentication & secrets

- Your Lane API key authenticates both the CLI (`~/.lane/config.json`) and the
  MCP servers (plugin config). It is **not** card data; it scopes access to your
  own Lane account's wallet operations. API keys are allowlisted per account.
- The plugin does not log card numbers, cryptograms, or passkey material.

## Environment

This is pre-launch software. The bundled MCP endpoints currently point at Lane
**staging** (`mcp-staging.aws.getonlane.com`), and account access is gated. Do
not treat it as a generally-available production service yet.

## Reporting a vulnerability

Email **agentic@getonlane.com** with details. Please do not open public issues
for security reports.
