import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('landing has real MCP onboarding sections', () => {
  for (const id of ['main', 'features', 'setup', 'limits', 'codex-config', 'opencode-config']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing anchor: ' + id);
  }
  assert.match(html, /Authorization/);
  assert.match(html, /makers-conversation-id/);
  assert.match(html, /YOUR-DEPLOYMENT/);
});

test('landing has no private credentials or tracking dependencies', () => {
  assert.doesNotMatch(html, /sit_[A-Za-z0-9_-]{12,}/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /prefers-reduced-motion/);
});

test('claims are deliberately bounded', () => {
  assert.match(html, /18\/21/);
  assert.match(html, /56 minutes/);
  assert.match(html, /privileged sandbox command/);
});
