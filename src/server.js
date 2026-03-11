/**
 * MCP server setup — registers all linkedin_* tools and wires up handlers.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleComment } from "./tools/comment.js";
import { handleDelete } from "./tools/delete.js";
import { handlePublish } from "./tools/publish.js";
import { handleReact } from "./tools/react.js";

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
	{
		name: "linkedin_publish",
		description:
			"Publish an original post to LinkedIn via Unipile. " +
			"IMPORTANT: dry_run defaults to true — this returns a preview showing the formatted text, " +
			"resolved mentions, validated media, and character count. Review the preview carefully, " +
			"then call again with dry_run=false to actually publish. " +
			"Supports text (max 3000 chars), media attachments (local file paths or URLs to images/videos: " +
			"jpg, png, gif, webp, mp4), and company @mentions (pass company names — they are resolved " +
			"automatically via Unipile and injected as {{0}}, {{1}} placeholders). " +
			"WORKFLOW: 1) Call with dry_run=true, 2) Present preview to user, 3) Get confirmation, " +
			"4) Call with dry_run=false.",
		inputSchema: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description:
						"Post body text. Maximum 3000 characters. Include company names here if you want them @mentioned — they will be replaced with Unipile placeholders automatically.",
				},
				media: {
					type: "array",
					items: { type: "string" },
					description:
						"Optional. Array of local file paths or URLs to attach. Supported formats: jpg, png, gif, webp, mp4. URLs are downloaded to /tmp automatically.",
					default: [],
				},
				mentions: {
					type: "array",
					items: { type: "string" },
					description:
						'Optional. Array of company names to @mention (e.g. ["Microsoft", "OpenAI"]). Each name is resolved to a LinkedIn company ID via Unipile.',
					default: [],
				},
				dry_run: {
					type: "boolean",
					description:
						"DEFAULT TRUE. When true, returns a preview without publishing. Set to false only after user confirms the preview.",
					default: true,
				},
			},
			required: ["text"],
		},
	},
	{
		name: "linkedin_comment",
		description:
			"Post a comment on a LinkedIn post via Unipile. " +
			"IMPORTANT: dry_run defaults to true — this returns a preview of the comment without posting it. " +
			"WORKFLOW: 1) Call with dry_run=true, 2) Show preview to user, 3) Get confirmation, " +
			"4) Call with dry_run=false. " +
			"Accepts a LinkedIn post URL (e.g. https://linkedin.com/feed/update/urn:li:activity:12345) " +
			"or a raw URN (urn:li:activity:12345 or urn:li:ugcPost:67890).",
		inputSchema: {
			type: "object",
			properties: {
				post_url: {
					type: "string",
					description:
						"LinkedIn post URL (linkedin.com/feed/update/...) or raw URN (urn:li:activity:... or urn:li:ugcPost:...)",
				},
				text: {
					type: "string",
					description: "Comment text to post",
				},
				dry_run: {
					type: "boolean",
					description:
						"DEFAULT TRUE. When true, returns a preview without posting. Set to false only after user confirms.",
					default: true,
				},
			},
			required: ["post_url", "text"],
		},
	},
	{
		name: "linkedin_react",
		description:
			"React to a LinkedIn post via Unipile. " +
			"Sends a reaction (like, celebrate, support, love, insightful, funny) to a post. " +
			"This action is immediate — there is no dry_run option. " +
			"Confirm with the user before calling. " +
			"Accepts a LinkedIn post URL or raw URN.",
		inputSchema: {
			type: "object",
			properties: {
				post_url: {
					type: "string",
					description:
						"LinkedIn post URL (linkedin.com/feed/update/...) or raw URN (urn:li:activity:...)",
				},
				reaction_type: {
					type: "string",
					enum: ["like", "celebrate", "support", "love", "insightful", "funny"],
					description:
						'Reaction type. One of: like, celebrate, support, love, insightful, funny. Defaults to "like".',
					default: "like",
				},
			},
			required: ["post_url"],
		},
	},
	{
		name: "linkedin_delete_post",
		description:
			"Delete a LinkedIn post you previously published via Unipile. " +
			"Requires the Unipile post_id returned by linkedin_publish after a successful publish. " +
			"This action is immediate and irreversible — confirm with the user before calling.",
		inputSchema: {
			type: "object",
			properties: {
				post_id: {
					type: "string",
					description:
						"The Unipile post ID returned by linkedin_publish (not the LinkedIn post URL — this is an internal Unipile identifier)",
				},
			},
			required: ["post_id"],
		},
	},
];

// ─── Server Factory ──────────────────────────────────────────────────────────

export function createServer() {
	const server = new Server(
		{ name: "mcp-linkedin", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	);

	// List all available tools
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOLS,
	}));

	// Dispatch tool calls
	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;

		let result;
		try {
			switch (name) {
				case "linkedin_publish":
					result = await handlePublish(args || {});
					break;
				case "linkedin_comment":
					result = await handleComment(args || {});
					break;
				case "linkedin_react":
					result = await handleReact(args || {});
					break;
				case "linkedin_delete_post":
					result = await handleDelete(args || {});
					break;
				default:
					result = { error: `Unknown tool: ${name}` };
			}
		} catch (err) {
			console.error(`[server] Unhandled error in tool "${name}":`, err.message);
			result = { error: `Internal error: ${err.message}` };
		}

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(result, null, 2),
				},
			],
		};
	});

	return {
		run: async () => {
			const transport = new StdioServerTransport();
			await server.connect(transport);
			console.error("[mcp-linkedin] Server running on stdio");
		},
	};
}
