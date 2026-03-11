/**
 * Unipile API client — wraps all HTTP calls to the Unipile platform.
 *
 * Auth: X-API-KEY header on every request (from UNIPILE_API_KEY env var).
 * Base URL: https://{UNIPILE_DSN}/api/v1
 *
 * All methods return { success, data?, error?, details? } — never throw unhandled.
 */

import fs from "node:fs";
import axios from "axios";
import FormData from "form-data";

const API_KEY = process.env.UNIPILE_API_KEY || "";
const DSN = process.env.UNIPILE_DSN || "";
const BASE_URL = DSN ? `https://${DSN}/api/v1` : "";

// Session-level caches
let _accountId = null;
const _companyCache = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function authHeaders(extra = {}) {
	return {
		"X-API-KEY": API_KEY,
		Accept: "application/json",
		...extra,
	};
}

function apiError(prefix, err) {
	const status = err.response?.status;
	const body = err.response?.data;
	const msg = body?.message || body?.error || err.message;
	console.error(`[unipile] ${prefix}:`, msg, body ? JSON.stringify(body) : "");
	return { success: false, error: msg, details: body, status };
}

// ─── Account Resolution ─────────────────────────────────────────────────────

/**
 * Resolve the LinkedIn account ID from Unipile.
 * Finds the first account whose type/provider includes "linkedin".
 * Result is cached for the process lifetime.
 */
export async function resolveAccountId() {
	if (_accountId) return { success: true, data: _accountId };
	if (!API_KEY || !BASE_URL) {
		return { success: false, error: "UNIPILE_API_KEY or UNIPILE_DSN not set" };
	}

	try {
		const response = await axios.get(`${BASE_URL}/accounts`, {
			headers: authHeaders(),
			timeout: 15000,
		});

		const accounts = response.data?.items || response.data || [];
		const linkedinAccount = Array.isArray(accounts)
			? accounts.find(
					(a) =>
						(a.type || "").toLowerCase().includes("linkedin") ||
						(a.provider || "").toLowerCase().includes("linkedin"),
				)
			: null;

		if (!linkedinAccount) {
			return { success: false, error: "No LinkedIn account found in Unipile" };
		}

		_accountId = linkedinAccount.id || linkedinAccount.account_id;
		console.error(`[unipile] LinkedIn account resolved: ${_accountId}`);
		return { success: true, data: _accountId };
	} catch (err) {
		return apiError("resolveAccountId", err);
	}
}

// ─── Company Resolution ─────────────────────────────────────────────────────

/**
 * Resolve a company name to its Unipile profileId for @mention injection.
 * Slugifies the name and calls GET /linkedin/company/{slug}.
 * Results cached per session to avoid redundant API calls.
 *
 * @returns { success, data: { name, profileId }? , error? }
 */
export async function resolveCompanyId(companyName) {
	const cacheKey = companyName.toLowerCase();
	if (_companyCache.has(cacheKey)) {
		const cached = _companyCache.get(cacheKey);
		if (cached === null)
			return { success: false, error: `Company not found: ${companyName}` };
		return { success: true, data: cached };
	}

	const accountResult = await resolveAccountId();
	if (!accountResult.success) return accountResult;
	const accountId = accountResult.data;

	// Build slug candidates: hyphenated lowercase, then original lowercased
	const slug = companyName
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "");
	const candidates = [...new Set([slug, cacheKey])];

	for (const candidate of candidates) {
		try {
			const response = await axios.get(
				`${BASE_URL}/linkedin/company/${encodeURIComponent(candidate)}`,
				{
					headers: authHeaders(),
					params: { account_id: accountId },
					timeout: 10000,
				},
			);
			if (response.data?.id) {
				const result = {
					name: response.data.name || companyName,
					profileId: String(response.data.id),
				};
				_companyCache.set(cacheKey, result);
				console.error(
					`[unipile] Company resolved: "${companyName}" → ${result.profileId}`,
				);
				return { success: true, data: result };
			}
		} catch (err) {
			if (err.response?.status !== 404) {
				console.error(
					`[unipile] resolveCompanyId("${candidate}"):`,
					err.message,
				);
			}
		}
	}

	_companyCache.set(cacheKey, null); // Cache miss to avoid retry storms
	return { success: false, error: `Company not found: ${companyName}` };
}

// ─── Post Creation ──────────────────────────────────────────────────────────

/**
 * Create a LinkedIn post via Unipile POST /posts.
 * Sends multipart/form-data with text, optional attachments, and optional mentions.
 *
 * @param {string} accountId
 * @param {string} text - Post text with {{0}} {{1}} placeholders for mentions
 * @param {Array<{ filePath, filename, mimeType }>} mediaFiles
 * @param {Array<{ name, profileId }>} mentions - Resolved company objects
 * @returns { success, data: { postId, postedAt }?, error? }
 */
export async function createPost(
	accountId,
	text,
	mediaFiles = [],
	mentions = [],
) {
	try {
		const form = new FormData();
		form.append("account_id", accountId);
		form.append("text", text);

		// Append mention entries — Unipile indexed format: mentions[0][name], mentions[0][profile_id]
		for (let i = 0; i < mentions.length; i++) {
			form.append(`mentions[${i}][name]`, mentions[i].name);
			form.append(`mentions[${i}][profile_id]`, mentions[i].profileId);
			form.append(`mentions[${i}][is_company]`, "true");
		}

		// Attach media files as streams
		for (const media of mediaFiles) {
			const exists = fs.existsSync(media.filePath);
			if (!exists) {
				console.error(
					`[unipile] Skipping attachment — file not found: ${media.filePath}`,
				);
				continue;
			}
			const size = fs.statSync(media.filePath).size;
			if (size === 0) {
				console.error(
					`[unipile] Skipping attachment — file is empty: ${media.filePath}`,
				);
				continue;
			}
			form.append("attachments", fs.createReadStream(media.filePath), {
				filename: media.filename,
				contentType: media.mimeType,
			});
		}

		const response = await axios.post(`${BASE_URL}/posts`, form, {
			headers: {
				...form.getHeaders(),
				"X-API-KEY": API_KEY,
			},
			timeout: 60000,
		});

		const postId = response.data?.id || response.data?.post_id || null;
		return {
			success: true,
			data: {
				postId,
				postedAt: new Date().toISOString(),
			},
		};
	} catch (err) {
		return apiError("createPost", err);
	}
}

// ─── Comment ────────────────────────────────────────────────────────────────

/**
 * Post a comment on a LinkedIn post via Unipile POST /posts/{urn}/comments.
 *
 * @param {string} accountId
 * @param {string} postUrn - Full LinkedIn URN (urn:li:activity:... or urn:li:ugcPost:...)
 * @param {string} text
 * @returns { success, data: { commentId }?, error? }
 */
export async function createComment(accountId, postUrn, text) {
	try {
		const encodedUrn = encodeURIComponent(postUrn);
		const response = await axios.post(
			`${BASE_URL}/posts/${encodedUrn}/comments`,
			{ text, account_id: accountId },
			{
				headers: authHeaders({ "Content-Type": "application/json" }),
				timeout: 15000,
			},
		);

		const commentId = response.data?.id || response.data?.comment_id || null;
		return { success: true, data: { commentId } };
	} catch (err) {
		return apiError("createComment", err);
	}
}

// ─── Reaction ────────────────────────────────────────────────────────────────

/**
 * React to a LinkedIn post via Unipile POST /posts/reaction.
 *
 * @param {string} accountId
 * @param {string} postUrn - The social_id of the post (e.g. urn:li:activity:...)
 * @param {string} reactionType - like | celebrate | support | love | insightful | funny
 * @returns { success, data?, error? }
 */
export async function reactToPost(accountId, postUrn, reactionType = "like") {
	try {
		const response = await axios.post(
			`${BASE_URL}/posts/reaction`,
			{ account_id: accountId, post_id: postUrn, reaction_type: reactionType },
			{
				headers: authHeaders({ "Content-Type": "application/json" }),
				timeout: 15000,
			},
		);

		return { success: true, data: response.data };
	} catch (err) {
		return apiError("reactToPost", err);
	}
}

// ─── Delete Post ─────────────────────────────────────────────────────────────

/**
 * Delete a post via Unipile DELETE /posts/{id}.
 *
 * @param {string} postId - The Unipile post ID returned by createPost
 * @returns { success, data?, error? }
 */
export async function deletePost(postId) {
	try {
		const response = await axios.delete(
			`${BASE_URL}/posts/${encodeURIComponent(postId)}`,
			{
				headers: authHeaders(),
				timeout: 15000,
			},
		);

		return { success: true, data: response.data };
	} catch (err) {
		return apiError("deletePost", err);
	}
}
