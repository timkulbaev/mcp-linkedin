# Skill: LinkedIn Publishing via MCP

## Important: Agent Session Limitation

MCP tools (including all `linkedin_*` tools) are **not available in `--agent` sessions** (e.g. when launched via `claude --agent <name>`). They only load in top-level `claude` sessions.

**If you are inside an `--agent` session**, you must spawn a sub-agent to use these tools:

```bash
# Write your prompt first, then pipe it:
cat /tmp/linkedin-prompt.md | claude -p --dangerously-skip-permissions
```

The sub-agent runs as a top-level `claude` session and will have full access to all LinkedIn tools.

---

## Architecture: Dual-Provider

This MCP server uses two different backends depending on the content type:

| Content type | Provider | API |
|-------------|----------|-----|
| Posts (text + media + mentions) | Unipile | `POST /api/v1/posts` |
| Comments | Unipile | Comments API |
| Reactions | Unipile | Reactions API |
| Articles | LinkedIn native API | `POST https://api.linkedin.com/rest/posts` |
| Delete posts | LinkedIn native API | `DELETE https://api.linkedin.com/v2/ugcPosts/{urn}` |

Unipile requires a [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) account. LinkedIn native API requires OAuth2 credentials (client ID, client secret, access token, refresh token).

---

## Available Tools

| Tool | Purpose | Provider |
|------|---------|---------|
| `linkedin_publish` | Create an original LinkedIn post (text + optional media + @mentions) | Unipile |
| `linkedin_comment` | Comment on an existing LinkedIn post | Unipile |
| `linkedin_react` | React to a LinkedIn post (like, celebrate, support, love, insightful, funny) | Unipile |
| `linkedin_delete_post` | Delete a post you previously published | LinkedIn native API |
| `linkedin_article` | Create a LinkedIn article with title, body (Markdown), cover image, and source URL | LinkedIn native API |

---

## Safe Publishing Workflow

### CRITICAL: Always use dry_run first

`linkedin_publish`, `linkedin_comment`, and `linkedin_article` all default to `dry_run: true`.
**Never set `dry_run: false` without explicit user confirmation.**

---

## Tool: linkedin_publish

### Step-by-step workflow

1. **Call with dry_run: true** (default — can omit the parameter):
   ```
   linkedin_publish({ text: "Your post text here", dry_run: true })
   ```

2. **Present the preview to the user.** Include:
   - The final post text (with mention placeholders shown as `{{0}}`, `{{1}}`)
   - Character count vs 3000 limit
   - Media validation results (valid/invalid per file)
   - Resolved mentions (which company names were found vs not found)
   - Any warnings (e.g. "character limit exceeded", "1 media item could not be processed")
   - `ready_to_publish` flag

3. **Ask the user for confirmation** before publishing.
   Example: "The post looks good (142 chars, 1 image attached). Publish it?"

4. **Only after confirmation**, call with `dry_run: false`:
   ```
   linkedin_publish({ text: "Your post text here", dry_run: false })
   ```

5. **Report back** the post URL. Construct it from the `post_id`:
   ```
   https://www.linkedin.com/feed/update/urn:li:activity:{post_id}/
   ```
   This step is **mandatory** — always include the clickable URL in your response.

6. The publish response includes `auto_like` — the post is automatically liked after publishing.

### Post formatting best practices

- **Hashtags**: Use 3-5 relevant hashtags at the end, preceded by a blank line
- **Line breaks**: Use double newlines for paragraph breaks in LinkedIn posts
- **Character limit**: 3000 characters max. Keep it under 1300 for better reach
- **Emoji**: Use sparingly at the start of bullet points or sections
- **Mentions**: Pass company names in the `mentions` array — they are resolved automatically

---

## Tool: linkedin_article

### Step-by-step workflow

1. **Call with dry_run: true** to get a full preview:
   ```
   linkedin_article({
     title: "Your Article Title",
     body: "## Introduction\n\nYour **Markdown** body here...",
     source_url: "https://your-website.com/article",
     dry_run: true
   })
   ```

2. **Present the preview to the user.** Include:
   - Title and HTML body preview
   - Character counts vs limits
   - Cover image validation (if provided)
   - Token status (expiry dates)
   - Any warnings
   - `ready_to_publish` flag

3. **Ask for confirmation**, then call with `dry_run: false`:
   ```
   linkedin_article({
     title: "Your Article Title",
     body: "## Introduction\n\nYour **Markdown** body here...",
     source_url: "https://your-website.com/article",
     dry_run: false
   })
   ```

4. **Report the article URL** from the `share_url` field in the response.

5. The article is automatically liked after publishing (`auto_like` field in response).

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | yes | — | Article headline, max 150 characters |
| `body` | string | yes | — | Article body in Markdown. Max 100,000 characters. Supports headings, bold, italic, links, lists, code blocks. |
| `source_url` | string | **yes** | — | Canonical URL (required by LinkedIn API). Pass your article URL, blog post, or any relevant URL. |
| `cover_image` | string | no | — | Local file path or URL to a cover image (jpg, png, webp). |
| `topics` | string[] | no | `[]` | Article topics/tags. |
| `visibility` | string | no | `"PUBLIC"` | `"PUBLIC"` or `"CONNECTIONS"` |
| `author` | string | no | `"personal"` | `"personal"` (post as yourself) or an organization URN (`urn:li:organization:12345`) to post as a company. |
| `mentions` | string[] | no | `[]` | Company names to @mention (resolved via Unipile). |
| `dry_run` | boolean | no | `true` | Preview without publishing. |

**Note on `source_url`:** LinkedIn's REST API requires a source URL for all article posts. This is a hard requirement — articles without a source URL will fail with a 422 error. Always pass a valid URL even if the article content is original (you can use your blog, LinkedIn profile, or website).

### Token status monitoring

The article tool includes a `token_status` field in every response:

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

Possible status values:
- `healthy` — tokens valid, no warnings
- `access_token_expiring_soon` — access token expires within 30 days (will auto-refresh)
- `access_token_expired` — access token expired (auto-refresh will be attempted)
- `refresh_token_expiring_soon` — refresh token expires within 30 days (manual re-auth needed soon)
- `refresh_token_expired` — refresh token expired (manual re-auth required immediately)

### Examples

**Minimal article:**
```
linkedin_article({
  title: "5 Lessons From Scaling a B2B SaaS to 1000 Customers",
  body: "## The Beginning\n\nWhen we started in 2022, we had no roadmap...\n\n## What We Learned\n\n**Lesson 1:** Talk to customers every week.",
  source_url: "https://timconsulting.co/blog/scaling-b2b-saas",
  dry_run: true
})
```

**Article with cover image:**
```
linkedin_article({
  title: "Our New Product Is Live",
  body: "## We Did It\n\nAfter 6 months of building, we launched today.",
  source_url: "https://timconsulting.co/launch",
  cover_image: "/Users/Timur/Desktop/launch-banner.jpg",
  dry_run: true
})
```

**Article as company page:**
```
linkedin_article({
  title: "Industry Trends Report 2026",
  body: "## Executive Summary\n\nKey findings from our annual survey...",
  source_url: "https://timconsulting.co/reports/2026",
  author: "urn:li:organization:12345678",
  visibility: "PUBLIC",
  dry_run: true
})
```

---

## Tool: linkedin_comment

### Step-by-step workflow

1. **Call with dry_run: true**:
   ```
   linkedin_comment({
     post_url: "https://linkedin.com/feed/update/urn:li:activity:12345",
     text: "Great insight!",
     dry_run: true
   })
   ```

2. **Show the preview** (post URN, comment text, character count).

3. **Ask for confirmation.**

4. **Call with dry_run: false** after confirmation.

---

## Tool: linkedin_react

```
linkedin_react({
  post_url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
  reaction_type: "celebrate"
})
```

Note: `linkedin_react` has no dry_run — confirm with user before calling.

Reaction types: `like`, `celebrate`, `support`, `love`, `insightful`, `funny`.

---

## Tool: linkedin_delete_post

Accepts a LinkedIn post URL or raw URN. **Always confirm with user before calling — this is irreversible.**

```
linkedin_delete_post({
  post_url: "https://www.linkedin.com/feed/update/urn:li:activity:7437514186450104320/"
})
```

Also accepts raw URNs:
```
linkedin_delete_post({ post_url: "urn:li:activity:7437514186450104320" })
linkedin_delete_post({ post_url: "urn:li:ugcPost:7437514186450104320" })
```

---

## Native LinkedIn Articles via Chrome MCP

LinkedIn does not expose an API for creating native long-form articles (`linkedin.com/pulse/...`). No API provider (Unipile, Sprinklr, or LinkedIn itself) offers this. However, you can create native articles by automating the LinkedIn article editor in the user's browser via Chrome MCP tools.

**This is separate from `linkedin_article`** — that tool creates link share posts (external URL with rich card). This workflow creates actual native articles written on LinkedIn.

### When to use this

When the user asks to create, write, or publish a **native LinkedIn article** — long-form content hosted on LinkedIn itself. Indicators: "write an article on LinkedIn", "publish a LinkedIn article", "create a Pulse article", "post a long-form article".

### Workflow

**Phase 1: Content agreement (in the chat session)**

Collaborate with the user to finalize ALL article content before touching the browser:
- **Title** — article headline
- **Body** — full article text (write it in the session, get user approval)
- **Cover image** — path or URL if the user wants one (optional)
- **Any other details** — topics, formatting preferences

The content must be fully agreed upon. The user explicitly saying "publish", "go", "post it", or equivalent is the signal to proceed. **No additional confirmation gates after this point.**

**Phase 2: Browser automation (Chrome MCP)**

Once the user says "go", execute these steps without pausing for confirmation:

1. **Get browser context:**
   ```
   mcp__claude-in-chrome__tabs_context_mcp()
   ```

2. **Create a new tab:**
   ```
   mcp__claude-in-chrome__tabs_create_mcp()
   ```

3. **Navigate to the LinkedIn article editor:**
   ```
   mcp__claude-in-chrome__navigate_mcp({ url: "https://www.linkedin.com/article/new/", tabId: <id> })
   ```

4. **Screenshot to verify the editor loaded:**
   ```
   mcp__claude-in-chrome__screenshot_mcp({ tabId: <id> })
   ```
   - If LinkedIn shows a login page, tell the user to log into LinkedIn in their browser first, then retry.
   - If the editor loaded, proceed.

5. **Fill in the title:**
   - Click on the title field (usually a placeholder like "Title" at the top of the editor)
   - Type the agreed-upon title using `mcp__claude-in-chrome__type_text_mcp`

6. **Fill in the body:**
   - Click on the body area below the title
   - The LinkedIn editor is a rich text editor (contenteditable). For best results:
     - Type paragraph by paragraph
     - Use keyboard shortcuts for formatting: Ctrl+B for bold, Ctrl+I for italic
     - Press Enter twice for paragraph breaks
     - For headings, type the text and use the editor's formatting toolbar
   - Alternatively, use `mcp__claude-in-chrome__javascript_tool` to set the content programmatically if the editor supports it
   - Screenshot after pasting to verify the content looks correct

7. **Upload cover image (if agreed upon):**
   - Look for a "Cover image" or camera icon area at the top of the editor
   - Click it to trigger the file upload dialog
   - Note: file upload dialogs may require user interaction — if the browser shows a native file picker, tell the user which file to select

8. **Screenshot the final article for verification:**
   ```
   mcp__claude-in-chrome__screenshot_mcp({ tabId: <id> })
   ```
   - Quickly verify the content matches what was agreed upon
   - If something looks wrong, fix it before publishing

9. **Click Publish:**
   - Look for the "Publish" button (usually top-right of the editor)
   - Click it using `mcp__claude-in-chrome__click_mcp`
   - If LinkedIn shows a publish confirmation dialog (visibility, description, etc.), fill it in and confirm

10. **Verify publication:**
    - Screenshot the result page
    - Extract the article URL from the browser's address bar or from the published page
    - Report the URL back to the user

### Important notes

- **The user must be logged into LinkedIn** in their Chrome browser. This workflow uses their existing session — no OAuth or API keys needed for this path.
- **LinkedIn's UI changes periodically.** If the editor layout differs from what's described above, take a screenshot and adapt. Use the screenshot to identify the correct elements to click/type.
- **Cover image upload** may trigger a native file picker dialog that Chrome MCP cannot interact with. In that case, tell the user: "I've opened the file picker — please select [filename] from [path]."
- **No dry_run concept here.** The content was already agreed upon in the chat. The browser automation is the execution step, not a preview step.
- **If anything goes wrong** during browser automation (element not found, page not loading, unexpected dialog), take a screenshot and tell the user what happened. Do not retry blindly.

### Example conversation flow

```
User: "Write a LinkedIn article about how AI is transforming customer support"

Claude: [writes the article, presents title + body for review]

User: "Looks great, change the second paragraph to be shorter"

Claude: [revises, presents updated version]

User: "Perfect, publish it"

Claude: [opens Chrome → navigates to LinkedIn article editor → fills title →
         fills body → screenshots to verify → clicks Publish → reports URL]
```

---

| Error | What to do |
|-------|-----------|
| `"UNIPILE_API_KEY or UNIPILE_DSN not set"` | User hasn't configured Unipile credentials. Guide them to [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) to get credentials. |
| `"No LinkedIn account found in Unipile"` | User has Unipile but hasn't connected LinkedIn. Direct them to Unipile dashboard. |
| `"Mention not resolved: X"` | Company name not found. Try a different spelling or omit the mention. |
| `"Post exceeds 3000 character limit"` | Shorten the post text. |
| `"source_url is required for LinkedIn article posts"` | Pass a `source_url` — the LinkedIn API requires it for all article posts. |
| `"Title exceeds 150 character limit"` | Shorten the article title. |
| `"File not found: /path/to/file"` | File path is wrong or file was deleted. Verify with user. |
| `"Download failed: ..."` | URL is unreachable or private. Ask for a local file path. |
| `"Unsupported media type"` | Convert to jpg, png, gif, webp, or mp4 first. |
| `"Could not resolve LinkedIn profile"` | Access token is invalid or missing. Check `LINKEDIN_ACCESS_TOKEN` in `~/.claude/mcp.json`. |
| `"Refresh token is EXPIRED"` | Manual re-authorization required. See `docs/linkedin-tokens.md` for steps. |
| `"You can only delete posts published by your own account"` | Deletion failed with 403 — the post belongs to another account. |
| `"Post not found"` | Post may already be deleted. Treat as success. |

---

## Auto-Like Behavior

Both `linkedin_publish` and `linkedin_article` automatically like the post immediately after publishing. This is reported in the response as:

```json
{ "auto_like": "liked" }
```

If the auto-like fails (e.g. rate limit), the response contains an error message but the post itself is still published successfully.

---

## Warnings

- **Never auto-publish** — always show the dry_run preview and wait for explicit user confirmation.
- `source_url` is required by the LinkedIn API for articles. Always pass a URL.
- Media files downloaded from URLs are stored in `/tmp/mcp-linkedin-media/` and cleaned up after publish.
- Mention resolution is best-effort. Unresolved mentions appear in `warnings` — the post can still be published without them.
- Token expiry warnings in responses mean action is needed soon — see `docs/linkedin-tokens.md`.
