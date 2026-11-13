import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMazeContent, mazeGeneratorPath, renderMazeContent } from '../src/bot-maze.js';

test('minified generator output becomes escaped paragraphs and encoded local links', () => {
  const content = extractMazeContent('<title>Iocaine title</title><header><p>Iocaine banner</p></header><main><h1>Generator heading</h1><p>First &lt;script&gt; paragraph.<p>Second paragraph.<nav><a href=/iocaine/amber/>Garden &amp; gate</a><a href="https://external.invalid/">External</a><a href="//external.invalid/">External</a><a href="javascript:alert(1)">Script</a></nav></main><footer><p>Copyright 3406</p><a href=/footer/>Footer</a></footer>');
  assert.deepEqual(content.paragraphs, ['First <script> paragraph.', 'Second paragraph.']);
  assert.equal(content.links.length, 1);
  assert.equal(content.links[0].text, 'Garden & gate');
  assert.ok(content.links[0].href.startsWith('/reference-archive/entry/'));
  assert.doesNotMatch(content.links[0].href, /iocaine|amber/i);
  assert.equal(mazeGeneratorPath(content.links[0].href), '/iocaine/amber/');
  const html = renderMazeContent(content);
  assert.match(html, /<h1>Reference archive<\/h1>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Garden &amp; gate/);
  assert.doesNotMatch(html, /<script|Iocaine title|Iocaine banner|Generator heading|Copyright|external\.invalid/);
});

test('encoded generator paths cannot introduce queries, headers, or external destinations', () => {
  for (const path of ['//external.invalid/', '/path?token=secret', '/path#fragment', '/path\r\nheader: value', '/path\\other', 'not-rooted', `/${'a'.repeat(901)}`]) {
    assert.equal(mazeGeneratorPath(`/reference-archive/entry/${Buffer.from(path).toString('base64url')}`), null);
  }
  assert.equal(mazeGeneratorPath('/reference-archive/entry/%%%'), null);
  assert.equal(mazeGeneratorPath('/reference-archive/index'), '/');
  assert.equal(mazeGeneratorPath('/u/alice'), '/');
  assert.throws(() => extractMazeContent('<p>No related references.</p>'));
});
