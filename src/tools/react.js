/**
 * linkedin_react tool handler.
 * Reacts to a LinkedIn post with a given reaction type.
 */

import { reactToPost, resolveAccountId } from "../unipile-client.js";

const VALID_REACTIONS = [
	"like",
	"celebrate",
	"support",
	"love",
	"insightful",
	"funny",
];

export function parsePostUrn(postUrl) {
	if (!postUrl) return null;
	if (postUrl.startsWith("urn:li:")) return postUrl.trim();
	const match = postUrl.match(/urn:li:[^/?#\s]+/);
	if (match) return match[0];
	return null;
}

export async function handleReact(args) {
	const { post_url, reaction_type = "like" } = args;

	if (
		!post_url ||
		typeof post_url !== "string" ||
		post_url.trim().length === 0
	) {
		return { error: "post_url is required" };
	}

	if (!VALID_REACTIONS.includes(reaction_type)) {
		return {
			error: `Invalid reaction_type: "${reaction_type}". Must be one of: ${VALID_REACTIONS.join(", ")}`,
		};
	}

	const urn = parsePostUrn(post_url);
	if (!urn) {
		return {
			error: `Could not parse post URN from: "${post_url}". Provide a LinkedIn post URL or raw URN.`,
		};
	}

	const accountResult = await resolveAccountId();
	if (!accountResult.success) {
		return {
			error: `Could not resolve LinkedIn account: ${accountResult.error}`,
		};
	}

	const result = await reactToPost(accountResult.data, urn, reaction_type);
	if (!result.success) {
		return { error: result.error, details: result.details };
	}

	return {
		status: "reacted",
		post_urn: urn,
		reaction_type,
	};
}
