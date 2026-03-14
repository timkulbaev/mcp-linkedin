/**
 * LinkedIn native API client.
 *
 * Handles OAuth2 token management (read from env vars, auto-refresh on 401,
 * persist to ~/.config/mcp-linkedin/tokens.json) and all LinkedIn REST API calls
 * used by the article and delete tools.
 *
 * SECURITY: Token values are never logged. Only events are logged (e.g. "token refreshed").
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import axios from "axios";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(
	os.homedir(),
	".config",
	"mcp-linkedin",
	"tokens.json",
);

const TOKEN_FILE_DIR = path.dirname(TOKEN_FILE);

const LINKEDIN_API_V2 = "https://api.linkedin.com/v2";
const LINKEDIN_API_REST = "https://api.linkedin.com/rest";
const LINKEDIN_OAUTH_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_VERSION = "202503";

/** Days before expiry at which we emit a warning. */
const EXPIRY_WARNING_DAYS = 30;

// ─── Token State ──────────────────────────────────────────────────────────────

let _tokens = null; // loaded lazily
let _personUrn = null; // cached per process

// ─── Token File I/O ───────────────────────────────────────────────────────────

/**
 * Read tokens from file, falling back to env vars.
 * File takes precedence — it contains the most recently refreshed tokens.
 * @returns {{ access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, last_refreshed }}
 */
function loadTokens() {
	// Try token file first
	if (fs.existsSync(TOKEN_FILE)) {
		try {
			const raw = fs.readFileSync(TOKEN_FILE, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed.access_token && parsed.refresh_token) {
				console.error("[linkedin-api] Loaded tokens from file");
				return parsed;
			}
		} catch (err) {
			console.error("[linkedin-api] Could not read token file:", err.message);
		}
	}

	// Fall back to env vars
	const access_token = process.env.LINKEDIN_ACCESS_TOKEN || "";
	const refresh_token = process.env.LINKEDIN_REFRESH_TOKEN || "";

	if (!access_token || !refresh_token) {
		return null;
	}

	console.error("[linkedin-api] Loaded tokens from environment variables");
	return {
		access_token,
		refresh_token,
		access_token_expires_at: 1778666578, // July 9, 2026
		refresh_token_expires_at: 1805018579, // March 11, 2027
		last_refreshed: null,
	};
}

/**
 * Write tokens to the token file with 600 permissions.
 * NEVER logs token values.
 */
function saveTokens(tokens) {
	try {
		if (!fs.existsSync(TOKEN_FILE_DIR)) {
			fs.mkdirSync(TOKEN_FILE_DIR, { recursive: true, mode: 0o700 });
		}
		fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), {
			encoding: "utf8",
			mode: 0o600,
		});
		console.error("[linkedin-api] Tokens saved to file");
	} catch (err) {
		console.error("[linkedin-api] Could not save token file:", err.message);
	}
}

/**
 * Get the current token state (loaded on first call).
 * Logs a warning on startup if the refresh token is near expiry.
 */
function getTokens() {
	if (!_tokens) {
		_tokens = loadTokens();
		if (_tokens) {
			checkTokenExpiry(_tokens);
		}
	}
	return _tokens;
}

// ─── Token Expiry Checks ─────────────────────────────────────────────────────

/**
 * Returns a token_status object suitable for including in tool responses.
 */
export function getTokenStatus() {
	const tokens = getTokens();
	if (!tokens) {
		return { status: "missing", access_token_expires: null, refresh_token_expires: null };
	}

	const now = Math.floor(Date.now() / 1000);
	const accessExp = tokens.access_token_expires_at;
	const refreshExp = tokens.refresh_token_expires_at;

	const accessDaysLeft = Math.floor((accessExp - now) / 86400);
	const refreshDaysLeft = Math.floor((refreshExp - now) / 86400);

	const formatDate = (unix) =>
		new Date(unix * 1000).toISOString().split("T")[0];

	let status = "healthy";
	const warnings = [];

	if (accessDaysLeft < 0) {
		status = "access_token_expired";
		warnings.push("Access token is expired — will auto-refresh on next call");
	} else if (accessDaysLeft < EXPIRY_WARNING_DAYS) {
		status = "access_token_expiring_soon";
		warnings.push(`Access token expires in ${accessDaysLeft} days`);
	}

	if (refreshDaysLeft < 0) {
		status = "refresh_token_expired";
		warnings.push(
			"Refresh token is EXPIRED — re-authorization required via LinkedIn Developer Portal",
		);
	} else if (refreshDaysLeft < EXPIRY_WARNING_DAYS) {
		if (status === "healthy") status = "refresh_token_expiring_soon";
		warnings.push(
			`Refresh token expires in ${refreshDaysLeft} days — re-authorize soon`,
		);
	}

	return {
		status,
		access_token_expires: formatDate(accessExp),
		refresh_token_expires: formatDate(refreshExp),
		warnings,
	};
}

/**
 * Log startup warnings if tokens are near expiry.
 */
function checkTokenExpiry(tokens) {
	const now = Math.floor(Date.now() / 1000);
	const refreshDaysLeft = Math.floor(
		(tokens.refresh_token_expires_at - now) / 86400,
	);
	if (refreshDaysLeft < EXPIRY_WARNING_DAYS) {
		console.error(
			`[linkedin-api] WARNING: Refresh token expires in ${refreshDaysLeft} days. Re-authorize soon.`,
		);
	}
	const accessDaysLeft = Math.floor(
		(tokens.access_token_expires_at - now) / 86400,
	);
	if (accessDaysLeft < 0) {
		console.error(
			"[linkedin-api] Access token is expired — will refresh automatically on first API call",
		);
	}
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Refresh the access token using the refresh token.
 * Updates _tokens in memory and persists to file.
 * NEVER logs token values.
 * @returns {string} New access token
 */
async function refreshAccessToken() {
	const tokens = getTokens();
	if (!tokens) throw new Error("No LinkedIn credentials configured");

	const clientId = process.env.LINKEDIN_CLIENT_ID || "";
	const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || "";

	if (!clientId || !clientSecret) {
		throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are required for token refresh");
	}

	console.error("[linkedin-api] Refreshing access token...");

	const params = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: tokens.refresh_token,
		client_id: clientId,
		client_secret: clientSecret,
	});

	const response = await axios.post(LINKEDIN_OAUTH_URL, params.toString(), {
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		timeout: 15000,
	});

	const { access_token, expires_in, refresh_token: new_refresh } = response.data;

	const now = Math.floor(Date.now() / 1000);
	_tokens = {
		access_token,
		refresh_token: new_refresh || tokens.refresh_token,
		access_token_expires_at: now + (expires_in || 5184000),
		refresh_token_expires_at: tokens.refresh_token_expires_at,
		last_refreshed: new Date().toISOString(),
	};

	// Reset cached person URN so it gets re-fetched with new token
	_personUrn = null;

	saveTokens(_tokens);
	console.error("[linkedin-api] Access token refreshed successfully");

	return access_token;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

/**
 * Build standard auth headers for LinkedIn v2 API (no LinkedIn-Version header).
 */
function v2Headers(accessToken) {
	return {
		Authorization: `Bearer ${accessToken}`,
		"X-Restli-Protocol-Version": "2.0.0",
		Accept: "application/json",
	};
}

/**
 * Build standard auth headers for LinkedIn REST API (with LinkedIn-Version header).
 */
function restHeaders(accessToken, extra = {}) {
	return {
		Authorization: `Bearer ${accessToken}`,
		"LinkedIn-Version": LINKEDIN_VERSION,
		"X-Restli-Protocol-Version": "2.0.0",
		"Content-Type": "application/json",
		Accept: "application/json",
		...extra,
	};
}

/**
 * Make an authenticated API call, auto-refreshing on 401.
 * @param {Function} apiFn - async function(accessToken) => axios response
 * @returns axios response
 */
async function withAuth(apiFn) {
	const tokens = getTokens();
	if (!tokens) throw new Error("No LinkedIn credentials configured");

	try {
		return await apiFn(tokens.access_token);
	} catch (err) {
		if (err.response?.status === 401) {
			console.error("[linkedin-api] Got 401 — attempting token refresh");
			const newToken = await refreshAccessToken();
			return await apiFn(newToken);
		}
		throw err;
	}
}

// ─── Profile Resolution ───────────────────────────────────────────────────────

/**
 * Resolve the LinkedIn person URN for the authenticated user.
 * Cached per process lifetime.
 * @returns {string} e.g. "urn:li:person:abc123"
 */
export async function resolveLinkedInProfile() {
	if (_personUrn) return _personUrn;

	const response = await withAuth((token) =>
		axios.get(`${LINKEDIN_API_V2}/userinfo`, {
			headers: v2Headers(token),
			timeout: 10000,
		}),
	);

	const sub = response.data?.sub;
	if (!sub) throw new Error("Could not resolve LinkedIn person ID from /v2/userinfo");

	_personUrn = `urn:li:person:${sub}`;
	console.error(`[linkedin-api] Person URN resolved: ${_personUrn}`);
	return _personUrn;
}

// ─── Image Upload ─────────────────────────────────────────────────────────────

/**
 * Upload an image to LinkedIn (2-step: initialize + PUT binary data).
 * @param {string} filePath - Local file path to the image
 * @returns {string} Image URN (e.g. "urn:li:image:...")
 */
export async function uploadImage(filePath) {
	const personUrn = await resolveLinkedInProfile();

	// Step 1: Initialize upload
	const initResponse = await withAuth((token) =>
		axios.post(
			`${LINKEDIN_API_REST}/images?action=initializeUpload`,
			{ initializeUploadRequest: { owner: personUrn } },
			{
				headers: restHeaders(token),
				timeout: 15000,
			},
		),
	);

	const { uploadUrl, image: imageUrn } = initResponse.data?.value || {};
	if (!uploadUrl || !imageUrn) {
		throw new Error("LinkedIn image upload initialization failed — no uploadUrl or image URN returned");
	}

	console.error(`[linkedin-api] Image upload initialized: ${imageUrn}`);

	// Step 2: Upload binary data
	const fileBuffer = fs.readFileSync(filePath);
	const ext = filePath.split(".").pop().toLowerCase();
	const contentTypeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
	const contentType = contentTypeMap[ext] || "image/jpeg";

	await axios.put(uploadUrl, fileBuffer, {
		headers: { "Content-Type": contentType },
		timeout: 60000,
		maxBodyLength: 100 * 1024 * 1024,
	});

	console.error(`[linkedin-api] Image uploaded successfully: ${imageUrn}`);
	return imageUrn;
}

// ─── Article Creation ─────────────────────────────────────────────────────────

/**
 * Create a LinkedIn article share post via the REST Posts API.
 *
 * @param {string} authorUrn - e.g. "urn:li:person:abc123" or organization URN
 * @param {string} title - Article headline (max 150 chars)
 * @param {string} bodyHtml - HTML body (used as description snippet, max 300 chars plain text)
 * @param {string|null} imageUrn - LinkedIn image URN from uploadImage()
 * @param {string|null} sourceUrl - Canonical article URL
 * @param {string} visibility - "PUBLIC" or "CONNECTIONS"
 * @returns {{ postUrn: string, shareUrl: string }}
 */
export async function createArticle(
	authorUrn,
	title,
	bodyHtml,
	imageUrn = null,
	sourceUrl = null,
	visibility = "PUBLIC",
) {
	// Strip HTML tags for the description snippet
	const descriptionPlain = bodyHtml
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);

	// LinkedIn REST API requires source URL for article posts
	if (!sourceUrl) {
		throw new Error(
			"source_url is required for LinkedIn article posts. The LinkedIn API rejects articles without a source URL.",
		);
	}

	const articleContent = {
		title,
		description: descriptionPlain,
		source: sourceUrl,
	};

	if (imageUrn) {
		articleContent.thumbnail = imageUrn;
	}

	const body = {
		author: authorUrn,
		commentary: title,
		visibility,
		distribution: { feedDistribution: "MAIN_FEED" },
		content: { article: articleContent },
		lifecycleState: "PUBLISHED",
	};

	const response = await withAuth((token) =>
		axios.post(`${LINKEDIN_API_REST}/posts`, body, {
			headers: restHeaders(token),
			timeout: 30000,
		}),
	);

	// LinkedIn returns the post URN in the x-restli-id header
	const postUrn =
		response.headers["x-restli-id"] ||
		response.data?.id ||
		response.data?.urn ||
		null;

	if (!postUrn) {
		console.error("[linkedin-api] Response headers:", JSON.stringify(response.headers));
		console.error("[linkedin-api] Response data:", JSON.stringify(response.data));
		throw new Error("Article created but could not extract post URN from response");
	}

	const encodedUrn = encodeURIComponent(postUrn);
	const shareUrl = `https://www.linkedin.com/feed/update/${encodedUrn}/`;

	console.error(`[linkedin-api] Article created: ${postUrn}`);
	return { postUrn, shareUrl };
}

// ─── Post Deletion ────────────────────────────────────────────────────────────

/**
 * Delete a LinkedIn post using the v2 ugcPosts API.
 *
 * Accepts any URN type (urn:li:activity:, urn:li:ugcPost:, urn:li:share:) —
 * extracts the numeric ID and constructs the correct urn:li:ugcPost:{id} URN.
 *
 * @param {string} postUrn - LinkedIn post URN (any type)
 * @returns {{ success: boolean, error?: string }}
 */
export async function deletePost(postUrn) {
	// Extract numeric ID from URN (works with activity, ugcPost, share)
	const match = postUrn.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
	if (!match) {
		return { success: false, error: `Invalid post URN format: ${postUrn}` };
	}

	const numericId = match[1];
	const ugcPostUrn = `urn:li:ugcPost:${numericId}`;
	const encodedUrn = encodeURIComponent(ugcPostUrn);

	try {
		await withAuth((token) =>
			axios.delete(`${LINKEDIN_API_V2}/ugcPosts/${encodedUrn}`, {
				headers: v2Headers(token),
				timeout: 15000,
			}),
		);

		console.error(`[linkedin-api] Post deleted: ${ugcPostUrn}`);
		return { success: true };
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		const msg = body?.message || body?.error || err.message;
		console.error(`[linkedin-api] deletePost failed (${status}):`, msg);
		return { success: false, error: msg, status };
	}
}

// ─── Auto-Like ────────────────────────────────────────────────────────────────

/**
 * React to a post via LinkedIn REST API.
 * Used for auto-liking articles after creation.
 *
 * @param {string} postUrn - LinkedIn post URN
 * @returns {{ success: boolean, error?: string }}
 */
export async function reactToPost(postUrn) {
	const personUrn = await resolveLinkedInProfile();

	try {
		await withAuth((token) =>
			axios.post(
				`${LINKEDIN_API_REST}/reactions?action=thumbsUp`,
				{
					actor: personUrn,
					object: postUrn,
					reactionType: "LIKE",
				},
				{
					headers: restHeaders(token),
					timeout: 15000,
				},
			),
		);

		console.error(`[linkedin-api] Reacted to post: ${postUrn}`);
		return { success: true };
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		const msg = body?.message || body?.error || err.message;
		console.error(`[linkedin-api] reactToPost failed (${status}):`, msg);
		return { success: false, error: msg };
	}
}
