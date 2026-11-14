# chuskybrowser MCP

Give your AI assistant a browser. This MCP server works with Claude Code, Cursor, Codex and other MCP hosts.

## Setup

You need one thing: your chuskybrowser API key. Set it as `CHUSKYBROWSER_API_KEY`.

**Claude Code**

```bash
claude mcp add chuskybrowser -e CHUSKYBROWSER_API_KEY=your_key -- npx -y chuskybrowser-mcp
```

**Cursor** (`~/.cursor/mcp.json`)

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

**Other hosts:** use the same command and environment variable in your host's MCP settings.

Restart the host after adding the server. Then ask your assistant to open a page or read one.

## What it does

The server gives your assistant tools to open tabs, navigate, read pages, click, type, scroll and extract data. When a site needs a person to sign in or enter a code, the server hands the tab to that person and the assistant waits.

## Keep your key private

Your API key belongs to your account. Don't put it in shared code or public repos.
