# Skill: LinkedIn Publishing via Unipile MCP

## Important: Agent Session Limitation

MCP tools (including `linkedin_publish`) are **not available in `--agent` sessions** (e.g. when launched via `claude --agent <name>`). They only load in top-level `claude` sessions.

**If you are inside an `--agent` session**, you must spawn a sub-agent to use these tools:

```bash
# Write your prompt first, then pipe it:
cat /tmp/linkedin-prompt.md | claude -p --dangerously-skip-permissions
```

The sub-agent runs as a top-level `claude` session and will have full access to the `linkedin_publish` and other LinkedIn tools.

---

## Unipile Account Required

This MCP requires a [Unipile](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) account. If the user doesn't have one yet, or if any tool returns a credentials error, direct them to:

**https://www.unipile.com/?utm_source=partner&utm_campaign=tmc**

They need to:
1. Sign up for a Unipile account
2. Connect their LinkedIn account in the Unipile dashboard
3. Copy their API key and DSN
4. Add them to the MCP config (see the project README for setup instructions)

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `linkedin_publish` | Create an original LinkedIn post (with optional media + @mentions) |
| `linkedin_comment` | Comment on an existing LinkedIn post |
| `linkedin_react` | React to a LinkedIn post (like, celebrate, support, love, insightful, funny) |
| `linkedin_delete_post` | Delete a post you previously published |

---

## Safe Publishing Workflow

### CRITICAL: Always use dry_run first

`linkedin_publish` and `linkedin_comment` both default to `dry_run: true`.
**Never set `dry_run: false` without explicit user confirmation.**

### Step-by-step for linkedin_publish

1. **Call with dry_run: true** (default — can omit the parameter)
   ```
   linkedin_publish({ text: "Your post text here", dry_run: true })
   ```

2. **Present the preview to the user.** Include:
   - The final post text (with mention placeholders shown as {{0}}, {{1}})
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

5. **Report back** the `post_id` and `posted_at` from the response.
   Save the `post_id` if the user might want to delete it later.

6. **MANDATORY: Send the direct post URL.** Construct it from the `post_id` and present it to the user:
   ```
   https://www.linkedin.com/feed/update/urn:li:activity:{post_id}/
   ```
   Example: if `post_id` is `7437836150024650752`, the URL is:
   `https://www.linkedin.com/feed/update/urn:li:activity:7437836150024650752/`

   This step is not optional — always include the clickable URL in your response after a successful publish.

---

### Step-by-step for linkedin_comment

1. **Call with dry_run: true**:
   ```
   linkedin_comment({ post_url: "https://linkedin.com/feed/update/urn:li:activity:12345", text: "Great insight!", dry_run: true })
   ```

2. **Show the preview** (post URN, comment text, character count).

3. **Ask for confirmation.**

4. **Call with dry_run: false** after confirmation.

---

## Tool Examples

### Publish a plain text post
```
linkedin_publish({
  text: "Excited to share our new product launch! Check it out.",
  dry_run: true
})
```

### Publish with an image URL
```
linkedin_publish({
  text: "Here's our latest dashboard screenshot.",
  media: ["https://example.com/screenshot.png"],
  dry_run: true
})
```

### Publish with local file + company @mention
```
linkedin_publish({
  text: "Proud to partner with Microsoft on this initiative.",
  media: ["/path/to/partnership.jpg"],
  mentions: ["Microsoft"],
  dry_run: true
})
```
The tool resolves "Microsoft" -> LinkedIn company ID and injects `{{0}}` into the text automatically.

### Comment on a post
```
linkedin_comment({
  post_url: "urn:li:activity:7123456789012345678",
  text: "Totally agree — great perspective!",
  dry_run: true
})
```

### React to a post
```
linkedin_react({
  post_url: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
  reaction_type: "celebrate"
})
```
Note: `linkedin_react` has no dry_run — confirm with user before calling.

### Delete a post
```
linkedin_delete_post({ post_id: "the-unipile-post-id-from-publish" })
```
Note: irreversible — always confirm with user first.

---

## Error Handling Guidance

| Error | What to do |
|-------|-----------|
| "UNIPILE_API_KEY or UNIPILE_DSN not set" | The user hasn't configured Unipile credentials. Direct them to sign up at [unipile.com](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc), then add their API key and DSN to the MCP config. |
| "No LinkedIn account found in Unipile" | The user has a Unipile account but hasn't connected LinkedIn yet. Direct them to the [Unipile dashboard](https://www.unipile.com/?utm_source=partner&utm_campaign=tmc) to connect their LinkedIn account. |
| "Mention not resolved: X" | Company name not found in LinkedIn. Try a different spelling or omit the mention. |
| "Post exceeds 3000 character limit" | Shorten the post text before publishing. |
| "File not found: /path/to/file" | File path is wrong or file was deleted. Verify path with user. |
| "Download failed: ..." | URL is unreachable or private. Try downloading manually and providing a local path. |
| "Unsupported media type" | Convert the file to jpg, png, gif, webp, or mp4 first. |

---

## Warnings

- **Never auto-publish** — always show the dry_run preview and wait for explicit confirmation.
- The `post_id` returned by a successful publish is a Unipile-internal ID, not a LinkedIn URL. Store it if deletion may be needed.
- Mention resolution is best-effort. Unresolved mentions are reported in `warnings` — the post can still be published without them.
- Media files downloaded from URLs are stored in `/tmp/mcp-linkedin-media/` and cleaned up after publish.
