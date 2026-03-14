# mcp-linkedin

An MCP server that lets AI assistants publish to LinkedIn on your behalf.

## What it does

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that wraps the [Unipile API](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) to give AI assistants (Claude Code, Claude Desktop, or any MCP-compatible client) the ability to create posts, comments, and reactions on LinkedIn. The AI writes the content; this tool handles the publishing. All publishing actions default to preview mode — nothing goes live without explicit confirmation.

## Features

- 3 tools: publish, comment, react
- Dry run by default (preview before publishing)
- Auto-likes posts immediately after publishing
- Media attachments (local files or URLs — images and video)
- Company @mentions (auto-resolved via Unipile)
- Works with Claude Code, Claude Desktop, and any MCP client

## Prerequisites

- **Node.js 18+** — uses ES modules, `node:test`, and top-level await
- **Unipile account** — [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) is the service that connects to LinkedIn's API. Sign up, connect your LinkedIn account, and get your API key and DSN from the dashboard.

## Installation

```bash
git clone https://github.com/timkulbaev/mcp-linkedin.git
cd mcp-linkedin
npm install
```

## Configuration

### Claude Code

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-linkedin/index.js"],
      "env": {
        "UNIPILE_API_KEY": "your-unipile-api-key",
        "UNIPILE_DSN": "apiXX.unipile.com:XXXXX"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-linkedin/index.js"],
      "env": {
        "UNIPILE_API_KEY": "your-unipile-api-key",
        "UNIPILE_DSN": "apiXX.unipile.com:XXXXX"
      }
    }
  }
}
```

Restart Claude Code or Claude Desktop after editing the config.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `UNIPILE_API_KEY` | Yes | Your Unipile API key (from the Unipile dashboard) |
| `UNIPILE_DSN` | Yes | Your Unipile DSN (e.g. `api16.unipile.com:14648`) |

These are passed via the MCP config, not a `.env` file. The server reads them from `process.env` at startup.

## Tools

### linkedin_publish

Creates an original LinkedIn post.

**dry_run defaults to true.** Call with dry_run: true first to get a preview, then call again with dry_run: false to actually publish.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | yes | — | Post body, max 3000 characters |
| `media` | string[] | no | `[]` | Local file paths or URLs (jpg, png, gif, webp, mp4) |
| `mentions` | string[] | no | `[]` | Company names to @mention (auto-resolved) |
| `dry_run` | boolean | no | `true` | Preview without publishing |

Preview response (dry_run: true):

```json
{
  "status": "preview",
  "post_text": "Hello LinkedIn!",
  "character_count": 16,
  "character_limit": 3000,
  "media": [],
  "mentions": [],
  "warnings": [],
  "ready_to_publish": true
}
```

Publish response (dry_run: false):

```json
{
  "status": "published",
  "post_id": "7437514186450104320",
  "post_text": "Hello LinkedIn!",
  "posted_at": "2026-03-11T15:06:04.849Z",
  "auto_like": "liked"
}
```

After publish, save the `post_id` and construct the post URL:
```
https://www.linkedin.com/feed/update/urn:li:activity:{post_id}/
```

---

### linkedin_comment

Posts a comment on an existing LinkedIn post.

**dry_run defaults to true.**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `post_url` | string | yes | — | LinkedIn post URL or raw URN (urn:li:activity:... or urn:li:ugcPost:...) |
| `text` | string | yes | — | Comment text |
| `dry_run` | boolean | no | `true` | Preview without posting |

---

### linkedin_react

Reacts to a LinkedIn post. This action is immediate — there is no dry_run.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `post_url` | string | yes | — | LinkedIn post URL or raw URN |
| `reaction_type` | string | no | `"like"` | One of: `like`, `celebrate`, `support`, `love`, `insightful`, `funny` |

---

## How it works

```
                    ┌──────────────────────────────────┐
                    │           mcp-linkedin            │
AI Assistant  ──►   │                                  │
(via MCP stdio)     │  Posts/Comments/Reactions  ──►  Unipile API  ──►  LinkedIn
                    └──────────────────────────────────┘
```

- The AI assistant calls tools via MCP's JSON-RPC protocol over stdio
- Calls Unipile API which handles LinkedIn OAuth — no token management needed

## Safe publishing workflow

The dry_run default exists to prevent accidental publishing. The intended flow:

1. AI calls the tool with `dry_run: true` (the default)
2. You see the preview: final text, character count, media validation, resolved mentions, warnings
3. You confirm or ask for changes
4. AI calls again with `dry_run: false`
5. Post goes live

`dry_run` is `true` by default. The AI cannot publish without explicitly setting it to `false`, which requires going through the preview step first.

## Media handling

- Pass local file paths (`/path/to/image.jpg`) or URLs (`https://example.com/img.png`)
- URLs are downloaded to `/tmp/mcp-linkedin-media/` and cleaned up after publish (whether it succeeds or fails)
- Supported formats: jpg, jpeg, png, gif, webp (images), mp4 (video)
- Each file is validated before upload: must exist, be non-empty, and be a supported type
- Failed files appear in the preview's `media` array with `"valid": false` and an error message

## Company @mentions

- Pass company names as strings: `mentions: ["Microsoft", "OpenAI"]`
- The server slugifies each name and looks it up via Unipile's LinkedIn company search
- Resolved companies are injected as `{{0}}`, `{{1}}` placeholders in the post text — LinkedIn renders these as clickable @mentions
- If a company name appears in the post text, it gets replaced in place; if not, the placeholder is appended
- Unresolved names appear as warnings in the preview. The post can still be published without them.

## Testing

```bash
npm test       # 28 unit tests, zero extra dependencies (Node.js built-in test runner)
npm run lint   # Biome linter
```

## Project structure

```
mcp-linkedin/
  index.js                    Entry point (stdio transport)
  package.json
  src/
    server.js                 MCP server and tool registration
    unipile-client.js         Unipile API wrapper (posts, comments, reactions)
    media-handler.js          URL download and file validation
    tools/
      publish.js              linkedin_publish handler
      comment.js              linkedin_comment handler
      react.js                linkedin_react handler
  tests/
    unit.test.js              28 unit tests
```

## Getting a Unipile account

1. Sign up for a [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) account
2. In the dashboard, connect your LinkedIn account
3. Copy your API key and DSN from the dashboard settings
4. Paste them into the MCP config (see Configuration above)

Unipile has a free tier that covers basic usage.

## License

MIT — see [LICENSE](./LICENSE).

## Credits

Built by [Timur Kulbaev](https://github.com/timkulbaev). Uses the [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic and the [Unipile API](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc).
