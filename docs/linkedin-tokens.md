# LinkedIn Token Management

This document covers how LinkedIn OAuth2 tokens are managed in mcp-linkedin, when they expire, and what to do when they do.

---

## Current Token Expiry

| Token | Expiry Date | Unix Timestamp |
|-------|-------------|----------------|
| Access token | July 9, 2026 | 1778666578 |
| Refresh token | March 11, 2027 | 1805018579 |

To check the current status at any time, call the `linkedin_article` tool with `dry_run: true` — the response includes a `token_status` field:

```json
{
  "token_status": {
    "status": "healthy",
    "access_token_expires": "2026-07-09",
    "refresh_token_expires": "2027-03-11",
    "warnings": []
  }
}
```

---

## How Token Storage Works

Tokens are stored in two places with a clear precedence rule:

1. **Token file** (`~/.config/mcp-linkedin/tokens.json`) — takes precedence. Updated automatically after every refresh.
2. **Environment variables** (`~/.claude/mcp.json` env block) — used as initial seed values if the token file doesn't exist yet.

On first run, the MCP server reads from env vars and the token file is created the first time a token refresh occurs.

### Token file format

```json
{
  "access_token": "AQV26SZi...",
  "refresh_token": "AQU7DB6L...",
  "access_token_expires_at": 1778666578,
  "refresh_token_expires_at": 1805018579,
  "last_refreshed": "2026-03-14T12:00:00.000Z"
}
```

File permissions are set to `600` (owner read/write only). Never commit this file.

---

## Automatic Token Refresh

The access token is refreshed automatically when a LinkedIn API call returns `401 Unauthorized`. The flow is:

1. API call fails with 401
2. Server calls `POST https://www.linkedin.com/oauth/v2/accessToken` with the refresh token
3. New access token received, stored in memory and in `~/.config/mcp-linkedin/tokens.json`
4. Original API call retried with the new token
5. Transparent to the caller — the tool response reflects the API result, not the intermediate refresh

**The refresh is invisible** — you will not notice it happening unless you check the MCP server logs (stderr). The log line is:

```
[linkedin-api] Access token refreshed successfully
```

Note: token values are **never logged**. Only events are logged.

---

## Warning System

The server emits warnings when tokens are near expiry:

- **Startup warning**: logged to stderr if the refresh token expires within 30 days
- **Response warnings**: included in every `linkedin_article` dry_run and publish response if either token expires within 30 days

Warning example in response:

```json
{
  "warnings": ["Refresh token expires in 18 days — re-authorize soon"]
}
```

---

## What To Do When the Refresh Token Expires

The refresh token expires approximately annually. When it expires, automatic refresh no longer works and all LinkedIn API calls will fail with 401.

### Steps to re-authorize:

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/) and open your app
2. In the **Auth** tab, use the OAuth 2.0 token generator to generate a new access + refresh token pair
3. Update `~/.claude/mcp.json` with the new tokens:
   ```json
   "LINKEDIN_ACCESS_TOKEN": "AQV...",
   "LINKEDIN_REFRESH_TOKEN": "AQU..."
   ```
4. Delete the old token file so it gets recreated from the new env vars:
   ```bash
   rm ~/.config/mcp-linkedin/tokens.json
   ```
5. Restart Claude Code (or any MCP client) to reload the config

The new access token will be used immediately. The server will create a new token file after the first successful API call.

---

## Required Credentials

These credentials must be set in the `linkedin` MCP server's `env` block in `~/.claude/mcp.json`:

| Variable | Purpose |
|----------|---------|
| `LINKEDIN_CLIENT_ID` | OAuth2 app client ID |
| `LINKEDIN_CLIENT_SECRET` | OAuth2 app client secret |
| `LINKEDIN_ACCESS_TOKEN` | Initial access token (seed value) |
| `LINKEDIN_REFRESH_TOKEN` | Refresh token (used to renew access tokens) |

The client ID and secret never expire — only the tokens do.

---

## Security Notes

- Token values are **never logged** to stdout or stderr — only events are logged
- The token file uses `600` permissions (readable only by the current user)
- Never commit `~/.config/mcp-linkedin/tokens.json` or `~/.claude/mcp.json` to version control
- The MCP server reads credentials from `process.env` — they are not accessible to MCP tool callers
