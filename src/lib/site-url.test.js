import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiteUrl } from './site-url-helper.js';

test('prefers an explicit site URL from environment variables', () => {
  assert.equal(resolveSiteUrl({ env: { VITE_SITE_URL: 'https://example.com/' } }), 'https://example.com');
});

test('uses the Vercel host when present', () => {
  assert.equal(resolveSiteUrl({ env: { VERCEL_URL: 'myapp.vercel.app' } }), 'https://myapp.vercel.app');
});

test('falls back to the current window origin', () => {
  assert.equal(resolveSiteUrl({ location: { origin: 'https://app.example.com' } }), 'https://app.example.com');
});
