/**
 * linkedin_article tool handler.
 *
 * Creates a LinkedIn article share post using LinkedIn's native REST API.
 * dry_run defaults to true — returns a full preview without publishing.
 *
 * Architecture: Dual-provider.
 * - Posts/comments/reactions: Unipile
 * - Articles + deletion: LinkedIn native API (this file)
 */

import { marked } from "marked";
import { cleanupTmpMedia, processMedia } from "../media-handler.js";
import { resolveCompanyId } from "../unipile-client.js";
import {
	resolveLinkedInProfile,
	uploadImage,
	createArticle,
	reactToPost,
	getTokenStatus,
} from "../linkedin-api-client.js";

const TITLE_MAX = 150;
const BODY_MAX = 100_000;

// ─── Markdown → HTML ──────────────────────────────────────────────────────────

/**
 * Convert Markdown body to HTML using marked.
 * Returns sanitized HTML string.
 */
export function markdownToHtml(markdown) {
	// Configure marked with safe defaults
	marked.setOptions({ async: false });
	return marked.parse(markdown);
}

// ─── Author Resolution ────────────────────────────────────────────────────────

/**
 * Resolve the author parameter to a LinkedIn URN.
 *
 * @param {string} author - "personal" or an organization URN / name
 * @param {string} personUrn - Resolved personal URN
 * @returns {{ authorUrn: string, authorType: string }}
 */
function resolveAuthor(author, personUrn) {
	if (!author || author === "personal") {
		return { authorUrn: personUrn, authorType: "personal" };
	}

	// Accept raw organization URN
	if (author.startsWith("urn:li:organization:") || author.startsWith("urn:li:company:")) {
		return { authorUrn: author, authorType: "organization" };
	}

	// Unknown format — fall back to personal with a warning
	return {
		authorUrn: personUrn,
		authorType: "personal",
		warning: `Unrecognized author "${author}" — posting as personal. Pass an organization URN (e.g. urn:li:organization:12345) to post as a company.`,
	};
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleArticle(args) {
	const {
		title,
		body,
		cover_image,
		source_url,
		topics = [],
		visibility = "PUBLIC",
		author = "personal",
		mentions = [],
		dry_run = true,
	} = args;

	// ── Input validation ──────────────────────────────────────────────────────

	if (!title || typeof title !== "string" || title.trim().length === 0) {
		return { error: "title is required and must be a non-empty string" };
	}

	if (!body || typeof body !== "string" || body.trim().length === 0) {
		return { error: "body is required and must be a non-empty string" };
	}

	if (title.trim().length > TITLE_MAX) {
		return {
			error: `Title exceeds ${TITLE_MAX} character limit (${title.trim().length} chars)`,
		};
	}

	if (body.trim().length > BODY_MAX) {
		return {
			error: `Body exceeds ${BODY_MAX} character limit (${body.trim().length} chars)`,
		};
	}

	if (!["PUBLIC", "CONNECTIONS"].includes(visibility)) {
		return {
			error: `Invalid visibility "${visibility}". Must be "PUBLIC" or "CONNECTIONS"`,
		};
	}

	// LinkedIn REST API requires source_url for article posts
	if (!source_url || typeof source_url !== "string" || source_url.trim().length === 0) {
		return {
			error: "source_url is required for LinkedIn article posts. The LinkedIn API requires a source URL (e.g. https://example.com/your-article).",
		};
	}

	const warnings = [];

	// ── Convert Markdown to HTML ──────────────────────────────────────────────

	const bodyHtml = markdownToHtml(body.trim());
	const bodyPlainPreview = body
		.trim()
		.replace(/[#*_`>~[\]]/g, "")
		.replace(/\s+/g, " ")
		.slice(0, 500);

	// ── Resolve LinkedIn profile ──────────────────────────────────────────────

	let personUrn;
	try {
		personUrn = await resolveLinkedInProfile();
	} catch (err) {
		return {
			error: `Could not resolve LinkedIn profile: ${err.message}. Check LINKEDIN_ACCESS_TOKEN is set.`,
		};
	}

	// ── Resolve author ────────────────────────────────────────────────────────

	const authorResult = resolveAuthor(author, personUrn);
	if (authorResult.warning) {
		warnings.push(authorResult.warning);
	}
	const { authorUrn, authorType } = authorResult;

	// ── Resolve mentions ──────────────────────────────────────────────────────

	const resolvedMentions = [];
	for (const companyName of mentions) {
		const result = await resolveCompanyId(companyName);
		if (result.success) {
			resolvedMentions.push({ name: result.data.name, resolved: true, profile_id: result.data.profileId });
		} else {
			resolvedMentions.push({ name: companyName, resolved: false });
			warnings.push(`Mention not resolved: "${companyName}" — ${result.error}`);
		}
	}

	// ── Process cover image ───────────────────────────────────────────────────

	let coverImageInfo = null;
	let resolvedMediaFile = null;

	if (cover_image) {
		const { resolved, failed } = await processMedia([cover_image]);

		if (failed.length > 0) {
			warnings.push(`Cover image could not be processed: ${failed[0].error}`);
		} else if (resolved.length > 0) {
			const m = resolved[0];
			// Only images allowed (no video for cover)
			if (m.mimeType.startsWith("video/")) {
				warnings.push("Cover image must be an image file, not video. Cover will be skipped.");
				cleanupTmpMedia();
			} else {
				coverImageInfo = {
					source: m.source,
					valid: true,
					type: m.mimeType,
					size_kb: Math.round(m.sizeBytes / 1024),
				};
				resolvedMediaFile = m;
			}
		}
	}

	// ── Token status ──────────────────────────────────────────────────────────

	const tokenStatus = getTokenStatus();
	if (tokenStatus.warnings && tokenStatus.warnings.length > 0) {
		warnings.push(...tokenStatus.warnings);
	}

	// ── Dry run — return preview ──────────────────────────────────────────────

	if (dry_run) {
		if (resolvedMediaFile) cleanupTmpMedia();
		return {
			status: "preview",
			title: title.trim(),
			body_html: bodyHtml,
			body_preview: bodyPlainPreview,
			body_character_count: body.trim().length,
			body_character_limit: BODY_MAX,
			cover_image: coverImageInfo,
			source_url: source_url.trim(),
			topics,
			author: authorUrn,
			author_type: authorType,
			visibility,
			mentions: resolvedMentions,
			token_status: tokenStatus,
			warnings,
			ready_to_publish: warnings.filter((w) => w.includes("exceeds") || w.includes("EXPIRED")).length === 0,
		};
	}

	// ── Publish ───────────────────────────────────────────────────────────────

	try {
		// Upload cover image if present
		let imageUrn = null;
		if (resolvedMediaFile) {
			try {
				imageUrn = await uploadImage(resolvedMediaFile.filePath);
			} catch (err) {
				warnings.push(`Cover image upload failed: ${err.message}. Publishing without cover image.`);
			}
		}

		// Create article
		const { postUrn, shareUrl } = await createArticle(
			authorUrn,
			title.trim(),
			bodyHtml,
			imageUrn,
			source_url.trim(),
			visibility,
		);

		// Auto-like
		let autoLike;
		try {
			const likeResult = await reactToPost(postUrn);
			autoLike = likeResult.success ? "liked" : `failed: ${likeResult.error}`;
		} catch (err) {
			autoLike = `failed: ${err.message}`;
		}

		return {
			status: "published",
			post_urn: postUrn,
			share_url: shareUrl,
			title: title.trim(),
			author: authorUrn,
			author_type: authorType,
			posted_at: new Date().toISOString(),
			auto_like: autoLike,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	} finally {
		cleanupTmpMedia();
	}
}
