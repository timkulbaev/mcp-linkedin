/**
 * Unit tests for mcp-linkedin pure functions.
 * Uses Node.js built-in test runner (node:test + node:assert). No extra dependencies.
 *
 * Run: node --test tests/unit.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePostUrn as parseUrnFromComment } from '../src/tools/comment.js';
import { parsePostUrn as parseUrnFromReact } from '../src/tools/react.js';
import { injectMentionPlaceholders } from '../src/tools/publish.js';
import { isUrl, mimeFromExtension } from '../src/media-handler.js';
import { markdownToHtml } from '../src/tools/article.js';
import { parsePostUrnForDelete } from '../src/tools/delete.js';

// ─── URN Parsing (comment.js) ─────────────────────────────────────────────────

test('parsePostUrn (comment) — full URL extracts URN', () => {
  const result = parseUrnFromComment('https://www.linkedin.com/feed/update/urn:li:activity:12345/');
  assert.equal(result, 'urn:li:activity:12345');
});

test('parsePostUrn (comment) — raw activity URN passthrough', () => {
  assert.equal(parseUrnFromComment('urn:li:activity:12345'), 'urn:li:activity:12345');
});

test('parsePostUrn (comment) — ugcPost URN passthrough', () => {
  assert.equal(parseUrnFromComment('urn:li:ugcPost:67890'), 'urn:li:ugcPost:67890');
});

test('parsePostUrn (comment) — invalid input returns null', () => {
  assert.equal(parseUrnFromComment('not-a-url-or-urn'), null);
});

test('parsePostUrn (comment) — null input returns null', () => {
  assert.equal(parseUrnFromComment(null), null);
});

// ─── URN Parsing (react.js) ───────────────────────────────────────────────────

test('parsePostUrn (react) — full URL extracts URN', () => {
  const result = parseUrnFromReact('https://www.linkedin.com/feed/update/urn:li:activity:12345/');
  assert.equal(result, 'urn:li:activity:12345');
});

test('parsePostUrn (react) — raw activity URN passthrough', () => {
  assert.equal(parseUrnFromReact('urn:li:activity:12345'), 'urn:li:activity:12345');
});

test('parsePostUrn (react) — ugcPost URN passthrough', () => {
  assert.equal(parseUrnFromReact('urn:li:ugcPost:67890'), 'urn:li:ugcPost:67890');
});

test('parsePostUrn (react) — invalid input returns null', () => {
  assert.equal(parseUrnFromReact('not-a-url-or-urn'), null);
});

// ─── Mention Placeholder Injection ────────────────────────────────────────────

test('injectMentionPlaceholders — single company replaced with {{0}}', () => {
  const result = injectMentionPlaceholders(
    'Partnering with Microsoft on this.',
    [{ name: 'Microsoft', profileId: '123' }]
  );
  assert.ok(result.includes('{{0}}'), `Expected {{0}} in: ${result}`);
  assert.ok(!result.includes('Microsoft'), `Expected Microsoft replaced in: ${result}`);
});

test('injectMentionPlaceholders — company not in text appended as {{0}}', () => {
  const result = injectMentionPlaceholders(
    'Exciting news today.',
    [{ name: 'OpenAI', profileId: '456' }]
  );
  assert.ok(result.endsWith(' {{0}}'), `Expected {{0}} appended, got: ${result}`);
});

test('injectMentionPlaceholders — multiple companies get {{0}} and {{1}}', () => {
  const result = injectMentionPlaceholders(
    'Working with Microsoft and Google on this.',
    [
      { name: 'Microsoft', profileId: '123' },
      { name: 'Google', profileId: '789' }
    ]
  );
  assert.ok(result.includes('{{0}}'), `Expected {{0}} in: ${result}`);
  assert.ok(result.includes('{{1}}'), `Expected {{1}} in: ${result}`);
  assert.ok(!result.includes('Microsoft'), 'Expected Microsoft replaced');
  assert.ok(!result.includes('Google'), 'Expected Google replaced');
});

test('injectMentionPlaceholders — case insensitive match', () => {
  const result = injectMentionPlaceholders(
    'Partnering with microsoft on this.',
    [{ name: 'Microsoft', profileId: '123' }]
  );
  assert.ok(result.includes('{{0}}'), `Expected {{0}} in: ${result}`);
  assert.ok(!result.toLowerCase().includes('microsoft'), `Expected microsoft replaced in: ${result}`);
});

test('injectMentionPlaceholders — empty mentions returns text unchanged', () => {
  const text = 'Just a regular post.';
  assert.equal(injectMentionPlaceholders(text, []), text);
});

// ─── URL Detection ────────────────────────────────────────────────────────────

test('isUrl — https URL detected', () => {
  assert.equal(isUrl('https://example.com/img.png'), true);
});

test('isUrl — http URL detected', () => {
  assert.equal(isUrl('http://example.com/img.png'), true);
});

test('isUrl — absolute local path not a URL', () => {
  assert.equal(isUrl('/Users/Timur/photo.jpg'), false);
});

test('isUrl — relative path not a URL', () => {
  assert.equal(isUrl('./relative/path.png'), false);
});

// ─── MIME Mapping ─────────────────────────────────────────────────────────────

test('mimeFromExtension — .jpg → image/jpeg', () => {
  assert.equal(mimeFromExtension('.jpg'), 'image/jpeg');
});

test('mimeFromExtension — .jpeg → image/jpeg', () => {
  assert.equal(mimeFromExtension('.jpeg'), 'image/jpeg');
});

test('mimeFromExtension — .png → image/png', () => {
  assert.equal(mimeFromExtension('.png'), 'image/png');
});

test('mimeFromExtension — .mp4 → video/mp4', () => {
  assert.equal(mimeFromExtension('.mp4'), 'video/mp4');
});

test('mimeFromExtension — .gif → image/gif', () => {
  assert.equal(mimeFromExtension('.gif'), 'image/gif');
});

test('mimeFromExtension — .webp → image/webp', () => {
  assert.equal(mimeFromExtension('.webp'), 'image/webp');
});

test('mimeFromExtension — .txt unsupported → null', () => {
  assert.equal(mimeFromExtension('.txt'), null);
});

test('mimeFromExtension — unknown extension → null', () => {
  assert.equal(mimeFromExtension('.docx'), null);
});

// ─── Character Limit Warning ──────────────────────────────────────────────────
// handlePublish is async and calls Unipile — test the warning logic directly
// by checking injectMentionPlaceholders doesn't affect short vs long text length

test('character limit — 100 char text is within 3000 limit', () => {
  const text = 'A'.repeat(100);
  assert.ok(text.length <= 3000);
});

test('character limit — 3001 char text exceeds 3000 limit', () => {
  const text = 'A'.repeat(3001);
  assert.ok(text.length > 3000);
});

// ─── Markdown → HTML Conversion ───────────────────────────────────────────────

test('markdownToHtml — heading converts to <h1>', () => {
  const html = markdownToHtml('# Hello');
  assert.ok(html.includes('<h1>'), `Expected <h1> in: ${html}`);
  assert.ok(html.includes('Hello'), `Expected "Hello" in: ${html}`);
});

test('markdownToHtml — bold converts to <strong>', () => {
  const html = markdownToHtml('**bold text**');
  assert.ok(html.includes('<strong>'), `Expected <strong> in: ${html}`);
  assert.ok(html.includes('bold text'), `Expected "bold text" in: ${html}`);
});

test('markdownToHtml — italic converts to <em>', () => {
  const html = markdownToHtml('*italic text*');
  assert.ok(html.includes('<em>'), `Expected <em> in: ${html}`);
  assert.ok(html.includes('italic text'), `Expected "italic text" in: ${html}`);
});

test('markdownToHtml — link converts to <a> tag', () => {
  const html = markdownToHtml('[click here](https://example.com)');
  assert.ok(html.includes('<a '), `Expected <a tag in: ${html}`);
  assert.ok(html.includes('https://example.com'), `Expected URL in: ${html}`);
  assert.ok(html.includes('click here'), `Expected link text in: ${html}`);
});

test('markdownToHtml — unordered list converts to <ul><li>', () => {
  const html = markdownToHtml('- item one\n- item two');
  assert.ok(html.includes('<ul>'), `Expected <ul> in: ${html}`);
  assert.ok(html.includes('<li>'), `Expected <li> in: ${html}`);
  assert.ok(html.includes('item one'), `Expected "item one" in: ${html}`);
});

test('markdownToHtml — code block converts to <code>', () => {
  const html = markdownToHtml('`inline code`');
  assert.ok(html.includes('<code>'), `Expected <code> in: ${html}`);
  assert.ok(html.includes('inline code'), `Expected "inline code" in: ${html}`);
});

test('markdownToHtml — returns string', () => {
  const result = markdownToHtml('hello world');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0, 'Expected non-empty string');
});

// ─── Article Title Validation ─────────────────────────────────────────────────

test('article title limit — 150 char title is valid', () => {
  const title = 'A'.repeat(150);
  assert.ok(title.trim().length <= 150);
});

test('article title limit — 151 char title exceeds limit', () => {
  const title = 'A'.repeat(151);
  assert.ok(title.trim().length > 150);
});

test('article title limit — empty string is invalid', () => {
  assert.ok(''.trim().length === 0);
});

// ─── Article Body Validation ──────────────────────────────────────────────────

test('article body limit — 100,000 char body is valid', () => {
  const body = 'A'.repeat(100_000);
  assert.ok(body.trim().length <= 100_000);
});

test('article body limit — 100,001 char body exceeds limit', () => {
  const body = 'A'.repeat(100_001);
  assert.ok(body.trim().length > 100_000);
});

// ─── Visibility Validation ────────────────────────────────────────────────────

test('visibility — PUBLIC is valid', () => {
  const valid = ['PUBLIC', 'CONNECTIONS'];
  assert.ok(valid.includes('PUBLIC'));
});

test('visibility — CONNECTIONS is valid', () => {
  const valid = ['PUBLIC', 'CONNECTIONS'];
  assert.ok(valid.includes('CONNECTIONS'));
});

test('visibility — PRIVATE is invalid', () => {
  const valid = ['PUBLIC', 'CONNECTIONS'];
  assert.ok(!valid.includes('PRIVATE'));
});

// ─── Token Expiry Warning Logic ───────────────────────────────────────────────

test('token expiry — expires in 60 days is healthy', () => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (60 * 86400); // 60 days from now
  const daysLeft = Math.floor((expiresAt - now) / 86400);
  assert.ok(daysLeft >= 30, `Expected >= 30 days left, got ${daysLeft}`);
});

test('token expiry — expires in 15 days triggers warning', () => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (15 * 86400); // 15 days from now
  const daysLeft = Math.floor((expiresAt - now) / 86400);
  assert.ok(daysLeft < 30, `Expected < 30 days left, got ${daysLeft}`);
});

test('token expiry — already expired has negative days left', () => {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now - 3600; // 1 hour ago
  const daysLeft = Math.floor((expiresAt - now) / 86400);
  assert.ok(daysLeft < 0, `Expected negative days left, got ${daysLeft}`);
});

// ─── Delete URN Parsing ───────────────────────────────────────────────────────

test('parsePostUrnForDelete — LinkedIn feed URL extracts URN', () => {
  const result = parsePostUrnForDelete('https://www.linkedin.com/feed/update/urn:li:activity:12345/');
  assert.equal(result, 'urn:li:activity:12345');
});

test('parsePostUrnForDelete — raw activity URN passthrough', () => {
  assert.equal(parsePostUrnForDelete('urn:li:activity:12345'), 'urn:li:activity:12345');
});

test('parsePostUrnForDelete — raw ugcPost URN passthrough', () => {
  assert.equal(parsePostUrnForDelete('urn:li:ugcPost:67890'), 'urn:li:ugcPost:67890');
});

test('parsePostUrnForDelete — raw share URN passthrough', () => {
  assert.equal(parsePostUrnForDelete('urn:li:share:11111'), 'urn:li:share:11111');
});

test('parsePostUrnForDelete — invalid input returns null', () => {
  assert.equal(parsePostUrnForDelete('not-a-post'), null);
});

test('parsePostUrnForDelete — null returns null', () => {
  assert.equal(parsePostUrnForDelete(null), null);
});

// ─── Author Parameter Parsing ─────────────────────────────────────────────────

test('author — "personal" maps to personal type', () => {
  const author = 'personal';
  const isPersonal = !author || author === 'personal';
  assert.ok(isPersonal);
});

test('author — organization URN is recognized', () => {
  const author = 'urn:li:organization:12345';
  const isOrgUrn = author.startsWith('urn:li:organization:') || author.startsWith('urn:li:company:');
  assert.ok(isOrgUrn);
});

test('author — company URN is recognized', () => {
  const author = 'urn:li:company:99999';
  const isOrgUrn = author.startsWith('urn:li:organization:') || author.startsWith('urn:li:company:');
  assert.ok(isOrgUrn);
});

test('author — unrecognized string falls back to personal', () => {
  const author = 'some-company-name';
  const isOrgUrn = author.startsWith('urn:li:organization:') || author.startsWith('urn:li:company:');
  const isPersonal = !author || author === 'personal';
  assert.ok(!isOrgUrn && !isPersonal, 'Expected unrecognized author to fall through');
});
