#!/usr/bin/env node
/**
 * mcp-linkedin — Stdio entry point
 * Starts the MCP server over stdio for use with Claude Code / Claude Desktop.
 */

import { createServer } from './src/server.js';

const server = createServer();
await server.run();
