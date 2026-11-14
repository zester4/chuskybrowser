# chuskybrowser MCP

Give your AI assistant a browser. Add chuskybrowser once, and it can open pages, read them, click, type, sign in to sites, and buy things for you.

You need one thing: your chuskybrowser API key. Set it as `CHUSKYBROWSER_API_KEY` wherever the config asks for it.

| | Client |
|---|---|
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/claudecode-color.svg" width="24"> | [Claude Code](#claude-code) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/codex-color.svg" width="24"> | [Codex](#codex) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/opencode.svg" width="24"> | [OpenCode](#opencode) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/copilot-color.svg" width="24"> | [GitHub Copilot](#github-copilot) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/cursor.svg" width="24"> | [Cursor](#cursor) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/windsurf.svg" width="24"> | [Windsurf](#windsurf) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/gemini-color.svg" width="24"> | [Gemini CLI](#gemini-cli) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/claude-color.svg" width="24"> | [Claude Desktop](#claude-desktop) |
| <img src="https://unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/cline.svg" width="24"> | [Cline](#cline) |

## Claude Code

```bash
claude mcp add chuskybrowser -e CHUSKYBROWSER_API_KEY=your_key -- npx -y chuskybrowser-mcp
```

## Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.chuskybrowser]
command = "npx"
args = ["-y", "chuskybrowser-mcp"]
env = { CHUSKYBROWSER_API_KEY = "your_key" }
```

## OpenCode

Add this to `opencode.json` in your project, or to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chuskybrowser": {
      "type": "local",
      "command": ["npx", "-y", "chuskybrowser-mcp"],
      "environment": { "CHUSKYBROWSER_API_KEY": "your_key" },
      "enabled": true
    }
  }
}
```

## GitHub Copilot

**VS Code:** add this to `.vscode/mcp.json` in your project.

```json
{
  "servers": {
    "chuskybrowser": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" }
    }
  }
}
```

**Copilot CLI:** add this to `~/.copilot/mcp-config.json`.

```json
{
  "mcpServers": {
    "chuskybrowser": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" },
      "tools": ["*"]
    }
  }
}
```

## Cursor

Add this to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project.

```json
{
  "mcpServers": {
    "chuskybrowser": {
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" }
    }
  }
}
```

## Windsurf

Add this to `~/.codeium/windsurf/mcp_config.json`.

```json
{
  "mcpServers": {
    "chuskybrowser": {
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" }
    }
  }
}
```

## Gemini CLI

Add this to `~/.gemini/settings.json`.

```json
{
  "mcpServers": {
    "chuskybrowser": {
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" }
    }
  }
}
```

## Claude Desktop

Add this to `claude_desktop_config.json` (Settings, then Developer, then Edit Config), then restart the app.

```json
{
  "mcpServers": {
    "chuskybrowser": {
      "command": "npx",
      "args": ["-y", "chuskybrowser-mcp"],
      "env": { "CHUSKYBROWSER_API_KEY": "your_key" }
    }
  }
}
```

## Cline

Open Cline's MCP settings, choose **Configure MCP Servers**, and add the same entry as in Claude Desktop above.

## After setup

Restart your client, then ask it to open a page, for example "Open example.com and tell me the heading."

## What it can do

- **Browse:** open tabs, navigate, read pages, click, type, scroll, take screenshots.
- **Sign in:** fill a saved login without the assistant seeing the password. When a site asks for a verification code, the person enters it in a live view.
- **Shop:** buy from real stores, with the user approving each purchase on their own device.

## Keep your key private

Your API key belongs to your account. Don't put it in shared files or public repos.
