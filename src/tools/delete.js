/**
 * linkedin_delete_post tool handler.
 *
 * Deletes a LinkedIn post using LinkedIn's native v2 ugcPosts API.
 * Accepts a LinkedIn post URL or any URN type (activity, ugcPost, share).
 *
 * CONFIRMED: DELETE https://api.linkedin.com/v2/ugcPosts/{encoded_urn}
 * - Returns 204 No Content on success
 * - Only X-Restli-Protocol-Version: 2.0.0 header (no LinkedIn-Version header)
 * - URN must be urn:li:ugcPost:{numericId} (not activity or share)
 */

import { deletePost } from "../linkedin-api-client.js";

/**
 * Extract a LinkedIn post URN from a URL or raw URN string.
 * Supports:
 *   - LinkedIn feed URLs: https://linkedin.com/feed/update/urn:li:activity:12345/
 *   - Raw URNs: urn:li:activity:12345, urn:li:ugcPost:12345, urn:li:share:12345
 *
 * @param {string} input
 * @returns {string|null} Extracted URN or null if not parseable
 */
export function parsePostUrnForDelete(input) {
	if (!input || typeof input !== "string") return null;

	const trimmed = input.trim();

	// Extract from LinkedIn feed URL
	const urlMatch = trimmed.match(
		/linkedin\.com\/feed\/update\/(urn:li:(?:activity|ugcPost|share):\d+)/i,
	);
	if (urlMatch) return decodeURIComponent(urlMatch[1]);

	// Raw URN passthrough
	if (/^urn:li:(?:activity|ugcPost|share):\d+$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}

export async function handleDelete(args) {
	// Support both old (post_id) and new (post_url / post_urn) param names
	const rawInput = args.post_url || args.post_urn || args.post_id;

	if (!rawInput || typeof rawInput !== "string" || rawInput.trim().length === 0) {
		return {
			error:
				"post_url is required. Pass a LinkedIn post URL (https://linkedin.com/feed/update/urn:li:activity:12345/) or a raw URN (urn:li:activity:12345 or urn:li:ugcPost:12345).",
		};
	}

	const postUrn = parsePostUrnForDelete(rawInput.trim());

	if (!postUrn) {
		return {
			error: `Could not parse a LinkedIn post URN from: "${rawInput.trim()}". ` +
				"Pass a LinkedIn feed URL or a URN like urn:li:activity:12345.",
		};
	}

	const result = await deletePost(postUrn);

	if (!result.success) {
		return {
			error: result.error,
			status_code: result.status,
			hint: result.status === 403
				? "You can only delete posts published by your own account."
				: result.status === 404
					? "Post not found — it may already have been deleted."
					: undefined,
		};
	}

	return {
		status: "deleted",
		post_urn: postUrn,
	};
}
