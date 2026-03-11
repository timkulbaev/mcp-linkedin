/**
 * linkedin_comment tool handler.
 * Posts a comment on a LinkedIn post.
 * dry_run defaults to true — returns a preview without posting.
 */

import { createComment, resolveAccountId } from "../unipile-client.js";

/**
 * Parse a LinkedIn post URL or raw URN into a canonical URN.
 * Handles:
 *   - Full URL: https://www.linkedin.com/feed/update/urn:li:activity:12345/
 *   - Raw URN: urn:li:activity:12345
 *   - Raw URN: urn:li:ugcPost:67890
 */
export function parsePostUrn(postUrl) {
	if (!postUrl) return null;

	// Already a URN
	if (postUrl.startsWith("urn:li:")) return postUrl.trim();

	// Extract URN from URL (linkedin.com/feed/update/urn:li:activity:...)
	const match = postUrl.match(/urn:li:[^/?#\s]+/);
	if (match) return match[0];

	return null;
}

export async function handleComment(args) {
	const { post_url, text, dry_run = true } = args;

	if (
		!post_url ||
		typeof post_url !== "string" ||
		post_url.trim().length === 0
	) {
		return { error: "post_url is required" };
	}
	if (!text || typeof text !== "string" || text.trim().length === 0) {
		return { error: "text is required and must be a non-empty string" };
	}

	const urn = parsePostUrn(post_url);
	if (!urn) {
		return {
			error: `Could not parse post URN from: "${post_url}". Provide a LinkedIn post URL (linkedin.com/feed/update/...) or a raw URN (urn:li:activity:...).`,
		};
	}

	// ── Dry run ──────────────────────────────────────────────────────────────
	if (dry_run) {
		return {
			status: "preview",
			post_urn: urn,
			comment_text: text,
			character_count: text.length,
			ready_to_post: true,
		};
	}

	// ── Resolve account and post ─────────────────────────────────────────────
	const accountResult = await resolveAccountId();
	if (!accountResult.success) {
		return {
			error: `Could not resolve LinkedIn account: ${accountResult.error}`,
		};
	}

	const result = await createComment(accountResult.data, urn, text);
	if (!result.success) {
		return { error: result.error, details: result.details };
	}

	return {
		status: "posted",
		post_urn: urn,
		comment_id: result.data.commentId,
		comment_text: text,
		posted_at: new Date().toISOString(),
	};
}
