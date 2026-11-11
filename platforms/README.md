# Using chuskybrowser from your AI tool

chuskybrowser runs as a local server (`npx chuskybrowser`) and exposes its tools to AI tools through the
`chuskybrowser-mcp` package. Each tool needs a small config entry that starts that package.

| Tool | Where the config goes | File in this folder |
|------|----------------------|---------------------|
| Claude Code | `.mcp.json` in the project, or install this repo as a plugin (already at the repo root) | `../.mcp.json` |
| Cursor | `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`) | `cursor/mcp.json` |
| Codex | `~/.codex/config.toml` | `codex/config.toml` |
| Hermes | `mcp_servers` in `~/.hermes/config.yaml` | `hermes/config.yaml` |
| Grok | `~/.grok/config.toml` | `grok/config.toml` |

## Steps (every tool)

1. Create an API key on your chuskybrowser account and set it in your shell or `.env`:
   ```
   CHUSKYBROWSER_API_KEY=cb_live_...
   ```
   The MCP entry forwards it. Never paste it into a file you commit. Nothing else is needed: the MCP package
   already knows where to reach chuskybrowser.
2. Running your own server instead? Start it with `npx chuskybrowser`, then set `CHUSKY_BASE_URL` (your server's
   address) and `CHUSKY_ACCESS_KEY` (the server's access key) in the same place. Those are for self-hosting only.
3. Copy the matching config above into your tool's config file, then restart the tool.
4. Ask the tool to open a page with chuskybrowser. If it can't see the tools, check that your key is set and
   that the tool was restarted after you set it.

Self-hosted servers: the MCP entry reads `CHUSKY_BASE_URL` and `CHUSKY_ACCESS_KEY` when `CHUSKYBROWSER_API_KEY`
is not set, and falls back to `http://localhost:9377` when neither is set.
