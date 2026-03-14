# mcp-linkedin

An MCP server that lets AI assistants publish to LinkedIn on your behalf.

## What it does

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that wraps the [Unipile API](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) (for posts, comments, reactions) and LinkedIn's native REST API (for articles and deletion) to give AI assistants (Claude Code, Claude Desktop, or any MCP-compatible client) the ability to create posts, articles, comments, reactions, and delete posts on LinkedIn. The AI writes the content; this tool handles the publishing. All publishing actions default to preview mode — nothing goes live without explicit confirmation.

## Features

- 5 tools: publish, comment, react, delete, article
- Dry run by default (preview before publishing)
- Auto-likes posts immediately after publishing
- Media attachments (local files or URLs — images and video)
- Company @mentions (auto-resolved via Unipile)
- Article creation with Markdown body, cover image, and source URL (via LinkedIn native API)
- Automatic OAuth2 token refresh for LinkedIn native API
- Works with Claude Code, Claude Desktop, and any MCP client

## Architecture: Dual-Provider

| Content type | Provider | API |
|-------------|----------|-----|
| Posts (text + media + mentions) | Unipile | `POST /api/v1/posts` |
| Comments | Unipile | Comments API |
| Reactions | Unipile | Reactions API |
| **Articles** | **LinkedIn native API** | `POST https://api.linkedin.com/rest/posts` |
| **Delete posts** | **LinkedIn native API** | `DELETE https://api.linkedin.com/v2/ugcPosts/{urn}` |

Unipile handles LinkedIn OAuth so you don't need to manage tokens for posts, comments, and reactions. For articles and deletion, you need LinkedIn OAuth2 credentials (client ID, client secret, access token, refresh token) — tokens are refreshed automatically.

## Prerequisites

**Required for all tools:**

- **Node.js 18+** — uses ES modules, `node:test`, and top-level await
- **Unipile account** — [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) is the service that connects to LinkedIn's API for posts, comments, and reactions. Sign up, connect your LinkedIn account, and get your API key and DSN from the dashboard.

**Required for article and delete tools:**

- **LinkedIn OAuth2 credentials** — Client ID, Client Secret, Access Token, Refresh Token from the [LinkedIn Developer Portal](https://www.linkedin.com/developers/).

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
        "UNIPILE_DSN": "apiXX.unipile.com:XXXXX",
        "LINKEDIN_CLIENT_ID": "your-linkedin-client-id",
        "LINKEDIN_CLIENT_SECRET": "your-linkedin-client-secret",
        "LINKEDIN_ACCESS_TOKEN": "your-linkedin-access-token",
        "LINKEDIN_REFRESH_TOKEN": "your-linkedin-refresh-token"
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
        "UNIPILE_DSN": "apiXX.unipile.com:XXXXX",
        "LINKEDIN_CLIENT_ID": "your-linkedin-client-id",
        "LINKEDIN_CLIENT_SECRET": "your-linkedin-client-secret",
        "LINKEDIN_ACCESS_TOKEN": "your-linkedin-access-token",
        "LINKEDIN_REFRESH_TOKEN": "your-linkedin-refresh-token"
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
| `LINKEDIN_CLIENT_ID` | For articles/delete | LinkedIn OAuth2 app client ID |
| `LINKEDIN_CLIENT_SECRET` | For articles/delete | LinkedIn OAuth2 app client secret |
| `LINKEDIN_ACCESS_TOKEN` | For articles/delete | Initial access token (auto-refreshed) |
| `LINKEDIN_REFRESH_TOKEN` | For articles/delete | Refresh token (used to renew access tokens) |

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

### linkedin_article

Creates a LinkedIn article post using LinkedIn's native REST API. The body accepts Markdown and is converted to HTML automatically. A cover image can be uploaded and embedded.

**dry_run defaults to true.**

**Important:** The LinkedIn API requires a `source_url` for all article posts. Always pass a valid URL even for original content.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | yes | — | Article headline, max 150 characters |
| `body` | string | yes | — | Article body in Markdown, max 100,000 characters |
| `source_url` | string | **yes** | — | Required by LinkedIn API. Pass your article URL, blog post, or any relevant URL. |
| `cover_image` | string | no | — | Local file path or URL to cover image (jpg, png, webp) |
| `topics` | string[] | no | `[]` | Article topics/tags |
| `visibility` | string | no | `"PUBLIC"` | `"PUBLIC"` or `"CONNECTIONS"` |
| `author` | string | no | `"personal"` | `"personal"` or an organization URN (`urn:li:organization:12345`) |
| `mentions` | string[] | no | `[]` | Company names to @mention (resolved via Unipile) |
| `dry_run` | boolean | no | `true` | Preview without publishing |

Preview response (dry_run: true):

```json
{
  "status": "preview",
  "title": "Article Title",
  "body_html": "<h2>Section</h2><p>Content...</p>",
  "body_preview": "First 500 chars of plain text...",
  "body_character_count": 1234,
  "body_character_limit": 100000,
  "cover_image": { "source": "/path/to/img.jpg", "valid": true, "type": "image/jpeg", "size_kb": 245 },
  "source_url": "https://example.com/article",
  "author": "urn:li:person:abc123",
  "author_type": "personal",
  "visibility": "PUBLIC",
  "token_status": {
    "status": "healthy",
    "access_token_expires": "2026-07-09",
    "refresh_token_expires": "2027-03-11",
    "warnings": []
  },
  "warnings": [],
  "ready_to_publish": true
}
```

Publish response (dry_run: false):

```json
{
  "status": "published",
  "post_urn": "urn:li:share:7437514186450104320",
  "share_url": "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7437514186450104320/",
  "title": "Article Title",
  "author": "urn:li:person:abc123",
  "author_type": "personal",
  "posted_at": "2026-03-14T12:00:00.000Z",
  "auto_like": "liked"
}
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

### linkedin_delete_post

Deletes a post using LinkedIn's native API. This action is immediate and irreversible.

Accepts a LinkedIn post URL or raw URN:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `post_url` | string | yes | LinkedIn post URL or URN (urn:li:activity:..., urn:li:ugcPost:..., urn:li:share:...) |

Response:

```json
{
  "status": "deleted",
  "post_urn": "urn:li:activity:7437514186450104320"
}
```

## How it works

```
                    ┌─────────────────────────────────────────────┐
                    │               mcp-linkedin                   │
AI Assistant  ──►   │                                             │
(via MCP stdio)     │  Posts/Comments/Reactions  ──►  Unipile API  ──►  LinkedIn
                    │  Articles/Delete            ──►  LinkedIn REST API
                    └─────────────────────────────────────────────┘
```

- The AI assistant calls tools via MCP's JSON-RPC protocol over stdio
- For posts/comments/reactions: calls Unipile API which handles LinkedIn OAuth
- For articles: calls LinkedIn's native REST API directly with OAuth2 token management
- For deletion: extracts numeric post ID, constructs ugcPost URN, calls LinkedIn's v2 ugcPosts API
- Token refresh happens automatically on 401 — transparent to the caller

## Token Management

LinkedIn OAuth2 tokens used by the article and delete tools are managed automatically:

- **Access tokens** auto-refresh on 401 — no manual action needed
- **Token file** (`~/.config/mcp-linkedin/tokens.json`) persists refreshed tokens across MCP restarts
- **Expiry warnings** appear in article tool responses when tokens expire within 30 days
- **Refresh tokens** expire annually — see `docs/linkedin-tokens.md` for re-authorization steps

## Safe publishing workflow

The dry_run default exists to prevent accidental publishing. The intended flow:

1. AI calls the tool with `dry_run: true` (the default)
2. You see the preview: final text, character count, media validation, resolved mentions, warnings
3. You confirm or ask for changes
4. AI calls again with `dry_run: false`
5. Post/article goes live

`dry_run` is `true` by default. The AI cannot publish without explicitly setting it to `false`, which requires going through the preview step first.

## Media handling

- Pass local file paths (`/path/to/image.jpg`) or URLs (`https://example.com/img.png`)
- URLs are downloaded to `/tmp/mcp-linkedin-media/` and cleaned up after publish (whether it succeeds or fails)
- Supported formats: jpg, jpeg, png, gif, webp (images), mp4 (video)
- Each file is validated before upload: must exist, be non-empty, and be a supported type
- Failed files appear in the preview's `media` array with `"valid": false` and an error message
- For articles, cover images are uploaded to LinkedIn's Images API and referenced by URN

## Company @mentions

- Pass company names as strings: `mentions: ["Microsoft", "OpenAI"]`
- The server slugifies each name and looks it up via Unipile's LinkedIn company search
- Resolved companies are injected as `{{0}}`, `{{1}}` placeholders in the post text — LinkedIn renders these as clickable @mentions
- If a company name appears in the post text, it gets replaced in place; if not, the placeholder is appended
- Unresolved names appear as warnings in the preview. The post can still be published without them.

## Testing

```bash
npm test       # 56 unit tests, zero extra dependencies (Node.js built-in test runner)
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
    linkedin-api-client.js    LinkedIn native API client (articles, deletion, token management)
    media-handler.js          URL download and file validation
    tools/
      publish.js              linkedin_publish handler
      comment.js              linkedin_comment handler
      react.js                linkedin_react handler
      delete.js               linkedin_delete_post handler
      article.js              linkedin_article handler
  tests/
    unit.test.js              56 unit tests
  docs/
    linkedin-tokens.md        Token management documentation
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

Built by [Timur Kulbaev](https://github.com/timkulbaev). Uses the [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic, the [Unipile API](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc), and the LinkedIn REST API.
