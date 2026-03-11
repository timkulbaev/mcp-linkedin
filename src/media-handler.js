/**
 * Media handler — downloads URLs and validates local files for LinkedIn post attachments.
 *
 * Input: array of strings (URLs starting with http/https, or local file paths)
 * Output: array of { filePath, filename, mimeType, sizeBytes, source }
 *
 * All downloaded files land in /tmp/mcp-linkedin-media/ and are cleaned up
 * after publish (success or error).
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const TMP_DIR = '/tmp/mcp-linkedin-media';

// MIME type map by extension
const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4'
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_MAP));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

function extensionFromContentType(contentType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4'
  };
  const base = (contentType || '').split(';')[0].trim().toLowerCase();
  return map[base] || null;
}

function mimeFromExtension(ext) {
  return MIME_MAP[ext.toLowerCase()] || null;
}

// ─── URL Download ─────────────────────────────────────────────────────────────

async function downloadUrl(url) {
  ensureTmpDir();

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: 100 * 1024 * 1024 // 100MB guard
    });

    const contentType = response.headers['content-type'] || '';
    let ext = extensionFromContentType(contentType);

    // Try to infer extension from URL if content-type is generic
    if (!ext) {
      const urlPath = new URL(url).pathname;
      ext = path.extname(urlPath).toLowerCase() || null;
    }

    if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) {
      response.data.destroy();
      return {
        success: false,
        source: url,
        error: `Unsupported media type: ${contentType || 'unknown'}. Supported: jpg, png, gif, webp, mp4`
      };
    }

    const filename = `media-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const filePath = path.join(TMP_DIR, filename);
    const mimeType = mimeFromExtension(ext);

    await pipeline(response.data, createWriteStream(filePath));

    const sizeBytes = fs.statSync(filePath).size;

    return {
      success: true,
      filePath,
      filename,
      mimeType,
      sizeBytes,
      source: url
    };
  } catch (err) {
    return {
      success: false,
      source: url,
      error: `Download failed: ${err.message}`
    };
  }
}

// ─── Local File Validation ────────────────────────────────────────────────────

function validateLocalFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { success: false, source: filePath, error: `File not found: ${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      success: false,
      source: filePath,
      error: `Unsupported file type: ${ext}. Supported: jpg, png, gif, webp, mp4`
    };
  }

  const mimeType = mimeFromExtension(ext);
  const sizeBytes = fs.statSync(filePath).size;

  if (sizeBytes === 0) {
    return { success: false, source: filePath, error: 'File is empty' };
  }

  return {
    success: true,
    filePath,
    filename: path.basename(filePath),
    mimeType,
    sizeBytes,
    source: filePath
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Process an array of media inputs (URLs or local paths).
 * Returns arrays of resolved and failed entries.
 *
 * @param {string[]} inputs
 * @returns {{ resolved: Array, failed: Array }}
 */
export async function processMedia(inputs) {
  const resolved = [];
  const failed = [];

  for (const input of inputs) {
    const isUrl = input.startsWith('http://') || input.startsWith('https://');
    const result = isUrl ? await downloadUrl(input) : validateLocalFile(input);

    if (result.success) {
      resolved.push(result);
    } else {
      failed.push({ source: result.source, error: result.error });
    }
  }

  return { resolved, failed };
}

/**
 * Remove all files from the temporary media directory.
 * Call after publish completes (success or error).
 */
export function cleanupTmpMedia() {
  if (!fs.existsSync(TMP_DIR)) return;
  try {
    const files = fs.readdirSync(TMP_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TMP_DIR, file));
    }
    console.error(`[media-handler] Cleaned up ${files.length} temp file(s)`);
  } catch (err) {
    console.error('[media-handler] Cleanup error:', err.message);
  }
}
