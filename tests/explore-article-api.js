/**
 * Unipile Article API Exploration Script
 *
 * Tests what Unipile supports for LinkedIn article creation.
 * CRITICAL: Every test that creates content deletes it immediately via try/finally.
 *
 * Run with:
 *   UNIPILE_API_KEY=xxx UNIPILE_DSN=yyy node tests/explore-article-api.js
 */

import axios from "axios";
import FormData from "form-data";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.UNIPILE_API_KEY;
const DSN = process.env.UNIPILE_DSN;

if (!API_KEY || !DSN) {
	console.error("ERROR: UNIPILE_API_KEY and UNIPILE_DSN must be set.");
	process.exit(1);
}

const BASE_URL = `https://${DSN}/api/v1`;

function authHeaders(extra = {}) {
	return {
		"X-API-KEY": API_KEY,
		Accept: "application/json",
		...extra,
	};
}

// ─── Results Accumulator ─────────────────────────────────────────────────────

const results = {
	endpointsFound: [],
	articleCreationSupported: null, // true/false/null=unknown
	articleParametersAccepted: [],
	articleParametersRejected: [],
	visibilitySupported: null,
	topicsSupported: null,
	deletionWorked: null,
	rawResponses: [],
	errors: [],
};

function log(section, ...args) {
	console.log(`\n[${"=".repeat(3)} ${section} ${"=".repeat(3)}]`);
	console.log(...args);
}

function logJSON(label, data) {
	console.log(`  ${label}:`, JSON.stringify(data, null, 2));
}

// ─── Resolve Account ID ───────────────────────────────────────────────────────

async function resolveAccountId() {
	log("ACCOUNT RESOLUTION", "Fetching LinkedIn account from Unipile...");
	const response = await axios.get(`${BASE_URL}/accounts`, {
		headers: authHeaders(),
		timeout: 15000,
	});

	const accounts = response.data?.items || response.data || [];
	logJSON("All accounts (raw)", response.data);

	const linkedinAccount = Array.isArray(accounts)
		? accounts.find(
				(a) =>
					(a.type || "").toLowerCase().includes("linkedin") ||
					(a.provider || "").toLowerCase().includes("linkedin"),
			)
		: null;

	if (!linkedinAccount) throw new Error("No LinkedIn account found in Unipile");

	const accountId = linkedinAccount.id || linkedinAccount.account_id;
	console.log(`  Resolved account_id: ${accountId}`);
	return accountId;
}

// ─── DELETE helper with logging ───────────────────────────────────────────────

async function deletePostSafely(postId, label) {
	if (!postId) {
		console.log(`  [DELETE] No post_id to delete for: ${label}`);
		results.deletionWorked = false;
		return;
	}
	try {
		console.log(`  [DELETE] Deleting post ${postId} (${label})...`);
		const resp = await axios.delete(
			`${BASE_URL}/posts/${encodeURIComponent(postId)}`,
			{
				headers: authHeaders(),
				timeout: 15000,
			},
		);
		console.log(`  [DELETE] Status: ${resp.status}`);
		logJSON("[DELETE] Body", resp.data);
		results.deletionWorked = true;
		console.log(`  [DELETE] SUCCESS — post ${postId} deleted.`);
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.error(`  [DELETE] FAILED — status ${status}:`, body || err.message);
		results.deletionWorked = false;
		results.errors.push(`DELETE ${postId} failed: ${err.message}`);
	}
}

// ─── TEST A: Endpoint Discovery ────────────────────────────────────────────────

async function testA_endpointDiscovery() {
	log("TEST A", "Checking Unipile API endpoint discovery...");

	// A1: GET /posts — check for type/content_type filter
	try {
		console.log("\n  A1: GET /posts (check for type/content_type params)");
		const resp = await axios.get(`${BASE_URL}/posts`, {
			headers: authHeaders(),
			params: { limit: 1 },
			timeout: 10000,
		});
		console.log(`  Status: ${resp.status}`);
		logJSON("Body (trimmed to first item)", {
			...resp.data,
			items: resp.data?.items?.slice(0, 1),
		});
		results.endpointsFound.push("GET /posts — OK");
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.endpointsFound.push(`GET /posts — ${status || err.message}`);
		results.errors.push(`GET /posts: ${err.message}`);
	}

	// A2: GET / or root discovery
	try {
		console.log("\n  A2: GET /api/v1 (root discovery)");
		const resp = await axios.get(`${BASE_URL}`, {
			headers: authHeaders(),
			timeout: 10000,
		});
		console.log(`  Status: ${resp.status}`);
		logJSON("Body", resp.data);
		results.endpointsFound.push("GET /api/v1 — OK");
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.endpointsFound.push(`GET /api/v1 — ${status || err.message}`);
	}

	// A3: GET /articles — does an articles endpoint exist?
	try {
		console.log("\n  A3: GET /articles (does this endpoint exist?)");
		const resp = await axios.get(`${BASE_URL}/articles`, {
			headers: authHeaders(),
			timeout: 10000,
		});
		console.log(`  Status: ${resp.status}`);
		logJSON("Body", resp.data);
		results.endpointsFound.push("GET /articles — EXISTS");
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.endpointsFound.push(`GET /articles — ${status || err.message}`);
		if (status === 404) {
			console.log("  => /articles endpoint does NOT exist (404).");
		}
	}

	// A4: GET /linkedin/articles — LinkedIn-specific articles endpoint?
	try {
		console.log("\n  A4: GET /linkedin/articles");
		const resp = await axios.get(`${BASE_URL}/linkedin/articles`, {
			headers: authHeaders(),
			timeout: 10000,
		});
		console.log(`  Status: ${resp.status}`);
		logJSON("Body", resp.data);
		results.endpointsFound.push("GET /linkedin/articles — EXISTS");
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.endpointsFound.push(
			`GET /linkedin/articles — ${status || err.message}`,
		);
	}
}

// ─── TEST B: Article Creation via FormData ─────────────────────────────────────

async function testB_articleFormData(accountId) {
	log(
		"TEST B1",
		"POST /posts with article title in FormData (article-style fields)...",
	);
	let postId = null;
	try {
		const form = new FormData();
		form.append("account_id", accountId);
		form.append(
			"text",
			"API Test — please ignore. Testing article creation via Unipile API. (FormData with title)",
		);
		form.append("title", "API Exploration Test Article — FormData");

		console.log("  Sending FormData with fields: account_id, text, title");

		const resp = await axios.post(`${BASE_URL}/posts`, form, {
			headers: {
				...form.getHeaders(),
				"X-API-KEY": API_KEY,
			},
			timeout: 30000,
		});

		console.log(`  Status: ${resp.status}`);
		logJSON("Response headers", resp.headers);
		logJSON("Response body", resp.data);

		postId =
			resp.data?.id ||
			resp.data?.post_id ||
			resp.data?.data?.id ||
			resp.data?.data?.post_id ||
			null;

		results.rawResponses.push({ test: "B1_formdata_title", status: resp.status, body: resp.data });

		if (resp.status >= 200 && resp.status < 300) {
			console.log("  => SUCCESS: FormData + title field accepted.");
			results.articleParametersAccepted.push("title (FormData)");
			results.articleCreationSupported = true;
		}
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.rawResponses.push({ test: "B1_formdata_title", status, body });
		results.articleParametersRejected.push(`title via FormData (HTTP ${status})`);
		results.errors.push(`B1 FormData+title: ${err.message}`);
		if (status === 422 || status === 400) {
			console.log("  => title field rejected or ignored by FormData endpoint.");
		}
	} finally {
		await deletePostSafely(postId, "B1 FormData+title");
	}
}

// ─── TEST B2: Article Creation via JSON body ────────────────────────────────────

async function testB2_articleJSON(accountId) {
	log(
		"TEST B2",
		"POST /posts with JSON body containing nested article content...",
	);
	let postId = null;
	try {
		const payload = {
			account_id: accountId,
			text: "API Test — please ignore. Testing article creation via Unipile API. (JSON body)",
			content: {
				article: {
					title: "API Exploration Test Article — JSON",
					description: "Testing article creation via Unipile API.",
					source: "https://example.com/test-article",
				},
			},
		};

		console.log("  Sending JSON:", JSON.stringify(payload, null, 2));

		const resp = await axios.post(`${BASE_URL}/posts`, payload, {
			headers: authHeaders({ "Content-Type": "application/json" }),
			timeout: 30000,
		});

		console.log(`  Status: ${resp.status}`);
		logJSON("Response headers", resp.headers);
		logJSON("Response body", resp.data);

		postId =
			resp.data?.id ||
			resp.data?.post_id ||
			resp.data?.data?.id ||
			resp.data?.data?.post_id ||
			null;

		results.rawResponses.push({ test: "B2_json_article", status: resp.status, body: resp.data });

		if (resp.status >= 200 && resp.status < 300) {
			console.log("  => SUCCESS: JSON body with content.article accepted.");
			results.articleParametersAccepted.push("content.article (JSON)");
			results.articleCreationSupported = true;
		}
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.rawResponses.push({ test: "B2_json_article", status, body });
		results.articleParametersRejected.push(`content.article via JSON (HTTP ${status})`);
		results.errors.push(`B2 JSON article: ${err.message}`);
	} finally {
		await deletePostSafely(postId, "B2 JSON article");
	}
}

// ─── TEST B3: Article link_content style ────────────────────────────────────────

async function testB3_linkContent(accountId) {
	log(
		"TEST B3",
		"POST /posts with link_content field (alternative article structure)...",
	);
	let postId = null;
	try {
		const payload = {
			account_id: accountId,
			text: "API Test — please ignore. Testing link_content field. (JSON body)",
			link_content: {
				title: "API Exploration Test — link_content",
				description: "Testing link_content structure.",
				url: "https://example.com/test-link",
			},
		};

		console.log("  Sending JSON with link_content:", JSON.stringify(payload, null, 2));

		const resp = await axios.post(`${BASE_URL}/posts`, payload, {
			headers: authHeaders({ "Content-Type": "application/json" }),
			timeout: 30000,
		});

		console.log(`  Status: ${resp.status}`);
		logJSON("Response body", resp.data);

		postId =
			resp.data?.id ||
			resp.data?.post_id ||
			resp.data?.data?.id ||
			resp.data?.data?.post_id ||
			null;

		results.rawResponses.push({ test: "B3_link_content", status: resp.status, body: resp.data });

		if (resp.status >= 200 && resp.status < 300) {
			console.log("  => SUCCESS: link_content field accepted.");
			results.articleParametersAccepted.push("link_content (JSON)");
		}
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.rawResponses.push({ test: "B3_link_content", status, body });
		results.articleParametersRejected.push(`link_content via JSON (HTTP ${status})`);
		results.errors.push(`B3 link_content: ${err.message}`);
	} finally {
		await deletePostSafely(postId, "B3 link_content");
	}
}

// ─── TEST D: Extra parameter probing ─────────────────────────────────────────

async function testD_visibilityParam(accountId) {
	log("TEST D1", "POST /posts with visibility parameter (FormData)...");
	let postId = null;
	try {
		const form = new FormData();
		form.append("account_id", accountId);
		form.append(
			"text",
			"API Test — please ignore. Testing visibility parameter.",
		);
		form.append("visibility", "PUBLIC");

		console.log("  Sending FormData with visibility=PUBLIC");

		const resp = await axios.post(`${BASE_URL}/posts`, form, {
			headers: {
				...form.getHeaders(),
				"X-API-KEY": API_KEY,
			},
			timeout: 30000,
		});

		console.log(`  Status: ${resp.status}`);
		logJSON("Response body", resp.data);

		postId =
			resp.data?.id ||
			resp.data?.post_id ||
			resp.data?.data?.id ||
			resp.data?.data?.post_id ||
			null;

		results.rawResponses.push({ test: "D1_visibility", status: resp.status, body: resp.data });
		results.visibilitySupported = resp.status >= 200 && resp.status < 300;

		if (results.visibilitySupported) {
			console.log("  => SUCCESS: visibility parameter accepted (post created).");
			results.articleParametersAccepted.push("visibility=PUBLIC");
		}
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.rawResponses.push({ test: "D1_visibility", status, body });
		results.visibilitySupported = false;
		results.errors.push(`D1 visibility: ${err.message}`);
	} finally {
		await deletePostSafely(postId, "D1 visibility");
	}
}

async function testD2_topicsParam(accountId) {
	log("TEST D2", "POST /posts with topics/tags parameter (JSON)...");
	let postId = null;
	try {
		// Try JSON body for topics since FormData can't easily nest arrays
		const payload = {
			account_id: accountId,
			text: "API Test — please ignore. Testing topics/tags parameter.",
			topics: ["technology", "ai"],
			tags: ["tech", "automation"],
		};

		console.log("  Sending JSON with topics and tags:", JSON.stringify(payload, null, 2));

		const resp = await axios.post(`${BASE_URL}/posts`, payload, {
			headers: authHeaders({ "Content-Type": "application/json" }),
			timeout: 30000,
		});

		console.log(`  Status: ${resp.status}`);
		logJSON("Response body", resp.data);

		postId =
			resp.data?.id ||
			resp.data?.post_id ||
			resp.data?.data?.id ||
			resp.data?.data?.post_id ||
			null;

		results.rawResponses.push({ test: "D2_topics", status: resp.status, body: resp.data });
		results.topicsSupported = resp.status >= 200 && resp.status < 300;

		if (results.topicsSupported) {
			console.log("  => SUCCESS: topics/tags parameters accepted.");
			results.articleParametersAccepted.push("topics, tags (JSON)");
		}
	} catch (err) {
		const status = err.response?.status;
		const body = err.response?.data;
		console.log(`  Status: ${status}`);
		logJSON("Error body", body);
		results.rawResponses.push({ test: "D2_topics", status, body });
		results.topicsSupported = false;
		results.errors.push(`D2 topics/tags: ${err.message}`);
	} finally {
		await deletePostSafely(postId, "D2 topics/tags");
	}
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log("=".repeat(60));
	console.log("  UNIPILE ARTICLE API EXPLORATION");
	console.log(`  Base URL: ${BASE_URL}`);
	console.log(`  API Key: ${API_KEY.slice(0, 8)}...`);
	console.log("=".repeat(60));

	// Resolve account first
	let accountId;
	try {
		accountId = await resolveAccountId();
	} catch (err) {
		console.error("FATAL: Could not resolve account ID:", err.message);
		process.exit(1);
	}

	// Run tests sequentially
	await testA_endpointDiscovery();
	await testB_articleFormData(accountId);
	await testB2_articleJSON(accountId);
	await testB3_linkContent(accountId);
	await testD_visibilityParam(accountId);
	await testD2_topicsParam(accountId);

	// ─── Summary ─────────────────────────────────────────────────────────────

	const separator = "=".repeat(60);
	console.log(`\n${separator}`);
	console.log("  UNIPILE ARTICLE API EXPLORATION RESULTS");
	console.log(separator);

	console.log("\nEndpoints found:");
	for (const e of results.endpointsFound) {
		console.log(`  - ${e}`);
	}

	console.log(
		`\nArticle creation supported: ${
			results.articleCreationSupported === true
				? "YES"
				: results.articleCreationSupported === false
					? "NO"
					: "UNKNOWN (all tests failed to create OR the post used text-only format)"
		}`,
	);

	console.log("\nArticle parameters ACCEPTED:");
	if (results.articleParametersAccepted.length === 0) {
		console.log("  None — all article-specific params were rejected or ignored");
	} else {
		for (const p of results.articleParametersAccepted) {
			console.log(`  + ${p}`);
		}
	}

	console.log("\nArticle parameters REJECTED:");
	if (results.articleParametersRejected.length === 0) {
		console.log("  None recorded");
	} else {
		for (const p of results.articleParametersRejected) {
			console.log(`  - ${p}`);
		}
	}

	console.log(
		`\nVisibility parameter supported: ${
			results.visibilitySupported === true
				? "YES"
				: results.visibilitySupported === false
					? "NO"
					: "UNKNOWN"
		}`,
	);

	console.log(
		`\nTopics/Tags parameters supported: ${
			results.topicsSupported === true
				? "YES"
				: results.topicsSupported === false
					? "NO"
					: "UNKNOWN"
		}`,
	);

	console.log(
		`\nDeletion confirmed: ${
			results.deletionWorked === true
				? "YES"
				: results.deletionWorked === false
					? "NO/PARTIAL"
					: "N/A (nothing created)"
		}`,
	);

	if (results.errors.length > 0) {
		console.log("\nErrors encountered:");
		for (const e of results.errors) {
			console.log(`  ! ${e}`);
		}
	}

	console.log("\nFindings:");
	if (results.articleCreationSupported === true) {
		console.log(
			"  - Unipile POST /posts CAN create article-style content via accepted parameters.",
		);
		console.log(
			"  - Accepted parameters: " + results.articleParametersAccepted.join(", "),
		);
	} else {
		console.log(
			"  - Unipile POST /posts does NOT appear to support dedicated article parameters.",
		);
		console.log(
			"  - Articles may need to be created via a separate endpoint or method.",
		);
		console.log(
			"  - Note: If B2/B3 succeeded as plain text posts (ignoring the article fields),",
		);
		console.log(
			"    that means Unipile silently strips unknown JSON fields and posts plain text.",
		);
	}
	console.log(
		"\n  NOTE: Check individual test output above for raw API response shapes.",
	);
	console.log(separator);
}

main().catch((err) => {
	console.error("UNHANDLED ERROR:", err.message, err.stack);
	process.exit(1);
});
