import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReferralLink,
  generateReferralCodeFromName,
  normalizeReferralCode,
} from './referral.ts';

test('normalizeReferralCode trims and uppercases values', () => {
  assert.equal(normalizeReferralCode('  abcd-1234  '), 'ABCD1234');
  assert.equal(normalizeReferralCode('  jane@doe  '), 'JANEDOE');
  assert.equal(normalizeReferralCode('https://example.com/signup?ref=abcd-1234'), 'ABCD1234');
});

test('generateReferralCodeFromName keeps a valid user prefix and four-digit suffix', () => {
  const code = generateReferralCodeFromName('Jane Doe');
  assert.match(code, /^JANE\d{4}$/);
});

test('buildReferralLink appends a valid ref query string', () => {
  assert.equal(buildReferralLink('ABCD1234', 'https://example.com'), 'https://example.com/signup?ref=ABCD1234');
  assert.equal(buildReferralLink('  abcd-1234  '), '/signup?ref=ABCD1234');
});
