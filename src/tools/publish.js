/**
 * linkedin_publish tool handler.
 * Creates an original LinkedIn post, with optional media and company @mentions.
 * dry_run defaults to true — returns a preview without posting.
 */

import { resolveAccountId, resolveCompanyId, createPost, reactToPost } from '../unipile-client.js';
import { processMedia, cleanupTmpMedia } from '../media-handler.js';

const CHAR_LIMIT = 3000;

/**
 * Inject mention placeholders into post text.
 * Replaces company names with {{0}}, {{1}}, etc.
 * If name not found in text, appends placeholder at end.
 */
function injectMentionPlaceholders(text, resolvedMentions) {
  let result = text;
  for (let i = 0; i < resolvedMentions.length; i++) {
    const name = resolvedMentions[i].name;
    const placeholder = `{{${i}}}`;
    const nameRegex = new RegExp(
      `(?<![\\w@])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`,
      'gi'
    );
    if (nameRegex.test(result)) {
      result = result.replace(nameRegex, placeholder);
    } else {
      result += ` ${placeholder}`;
    }
  }
  return result;
}

export async function handlePublish(args) {
  const {
    text,
    media = [],
    mentions = [],
    dry_run = true
  } = args;

  // ── Validate text ────────────────────────────────────────────────────────
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { error: 'text is required and must be a non-empty string' };
  }

  const warnings = [];

  // ── Resolve account ──────────────────────────────────────────────────────
  const accountResult = await resolveAccountId();
  if (!accountResult.success) {
    return { error: `Could not resolve LinkedIn account: ${accountResult.error}` };
  }
  const accountId = accountResult.data;

  // ── Resolve company mentions ─────────────────────────────────────────────
  const resolvedMentions = [];
  for (const companyName of mentions) {
    const result = await resolveCompanyId(companyName);
    if (result.success) {
      resolvedMentions.push(result.data);
    } else {
      warnings.push(`Mention not resolved: "${companyName}" — ${result.error}`);
    }
  }

  // ── Inject placeholders into text ────────────────────────────────────────
  const finalText = injectMentionPlaceholders(text, resolvedMentions);

  // ── Character count check ────────────────────────────────────────────────
  if (finalText.length > CHAR_LIMIT) {
    warnings.push(`Post exceeds ${CHAR_LIMIT} character limit (${finalText.length} chars). LinkedIn will reject it.`);
  }

  // ── Process media ────────────────────────────────────────────────────────
  let mediaResults = [];
  let mediaFiles = [];
  if (media.length > 0) {
    const { resolved, failed } = await processMedia(media);
    mediaFiles = resolved;

    mediaResults = [
      ...resolved.map(m => ({
        source: m.source,
        valid: true,
        type: m.mimeType,
        size_kb: Math.round(m.sizeBytes / 1024)
      })),
      ...failed.map(f => ({
        source: f.source,
        valid: false,
        error: f.error
      }))
    ];

    if (failed.length > 0) {
      warnings.push(`${failed.length} media item(s) could not be processed and will be skipped.`);
    }
  }

  // ── Dry run — return preview ─────────────────────────────────────────────
  if (dry_run) {
    cleanupTmpMedia(); // Clean up downloads since we won't publish
    return {
      status: 'preview',
      post_text: finalText,
      character_count: finalText.length,
      character_limit: CHAR_LIMIT,
      media: mediaResults,
      mentions: mentions.map((name, i) => {
        const resolved = resolvedMentions[i];
        return resolved
          ? { name: resolved.name, resolved: true, profile_id: resolved.profileId }
          : { name, resolved: false };
      }),
      warnings,
      ready_to_publish: warnings.length === 0 || !warnings.some(w => w.includes('exceeds'))
    };
  }

  // ── Publish ──────────────────────────────────────────────────────────────
  try {
    const result = await createPost(accountId, finalText, mediaFiles, resolvedMentions);

    if (!result.success) {
      return { error: result.error, details: result.details };
    }

    const postId = result.data.postId;

    // ── Auto-like the post ───────────────────────────────────────────────────
    let autoLike;
    if (postId) {
      const urn = `urn:li:activity:${postId}`;
      const likeResult = await reactToPost(accountId, urn, 'like');
      autoLike = likeResult.success ? 'liked' : `failed: ${likeResult.error}`;
    } else {
      autoLike = 'skipped: no post_id returned';
    }

    return {
      status: 'published',
      post_id: postId,
      post_text: finalText,
      posted_at: result.data.postedAt,
      auto_like: autoLike
    };
  } finally {
    cleanupTmpMedia();
  }
}
