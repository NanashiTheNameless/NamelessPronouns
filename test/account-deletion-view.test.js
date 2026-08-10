import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { fileURLToPath } from 'node:url';

const deletionView = fileURLToPath(new URL('../views/account/deletion.ejs', import.meta.url));
const headerView = fileURLToPath(new URL('../views/partials/site-header.ejs', import.meta.url));

function render(locals) {
  return ejs.renderFile(deletionView, {
    title: 'Delete account',
    csrfToken: 'csrf',
    user: { id: 'user-1', staff_role: 'none' },
    deletion: null,
    purgeAt: null,
    ...locals,
  }, { async: true });
}

test('a pending deletion drops navigation the restricted session cannot reach', async () => {
  const html = await render({
    deletion: { id: 'del-1', status: 'pending' },
    purgeAt: '2026-09-09T00:00:00.000Z',
    deletionRequest: { id: 'del-1' },
  });
  assert.match(html, /Your account is restricted/);
  assert.match(html, /Type CANCEL DELETION/);
  assert.doesNotMatch(html, /Back to settings/);
  assert.doesNotMatch(html, /href="\/settings"/, 'the restricted session cannot reach settings');
  assert.doesNotMatch(html, /href="\/dashboard"/);
});

test('the deletion page keeps its way back while no deletion is pending', async () => {
  const html = await render({});
  assert.match(html, /Back to settings/);
  assert.match(html, /Type DELETE MY ACCOUNT/);
});

test('the header offers a sign-out for any signed-in session', async () => {
  const html = await ejs.renderFile(headerView, {
    user: { id: 'user-1', staff_role: 'none' },
    csrfToken: 'csrf',
  }, { async: true });
  assert.match(html, /<form class="nav-logout" method="post" action="\/logout">/);
  assert.match(html, /name="_csrf" value="csrf"/);
  assert.match(html, />Sign out<\/button>/);
  assert.match(html, /href="\/dashboard"/);
});

test('a deletion-restricted header keeps only the sign-out', async () => {
  const html = await ejs.renderFile(headerView, {
    user: { id: 'user-1', staff_role: 'administrator' },
    csrfToken: 'csrf',
    deletionRequest: { id: 'del-1' },
  }, { async: true });
  assert.match(html, />Sign out<\/button>/);
  assert.doesNotMatch(html, /href="\/dashboard"/);
  assert.doesNotMatch(html, /href="\/settings"/);
  assert.doesNotMatch(html, /href="\/admin"/);
});

test('a signed-out header offers sign in rather than sign out', async () => {
  const html = await ejs.renderFile(headerView, { user: null }, { async: true });
  assert.match(html, /href="\/login"/);
  assert.doesNotMatch(html, /nav-logout/);
});
