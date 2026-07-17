// bind.test.mjs — pure tests for the one-shot row-page binder (optimization 03).
// Run: node --test scripts/project-cards/test/bind.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBindAction, repoBookmarkBlock } from '../bind-row-pages.mjs';

test('classifyBindAction: Notion URL -> skip (already bound)', () => {
  assert.equal(classifyBindAction('https://www.notion.so/Foo-38776fd7ac82'), 'skip-notion');
  assert.equal(classifyBindAction('https://app.notion.com/p/Foo-38776fd7ac82'), 'skip-notion');
});

test('classifyBindAction: GitHub URL -> bind-preserve (bookmark the repo first)', () => {
  assert.equal(classifyBindAction('https://github.com/Rev4nchist/agent-arch'), 'bind-preserve');
});

test('classifyBindAction: empty/null -> plain bind', () => {
  assert.equal(classifyBindAction(''), 'bind');
  assert.equal(classifyBindAction(null), 'bind');
  assert.equal(classifyBindAction(undefined), 'bind');
});

test('repoBookmarkBlock: a bookmark block carrying the repo url + provenance caption', () => {
  const b = repoBookmarkBlock('https://github.com/x/y');
  assert.equal(b.type, 'bookmark');
  assert.equal(b.bookmark.url, 'https://github.com/x/y');
  assert.match(b.bookmark.caption[0].text.content, /Project repository/);
});
