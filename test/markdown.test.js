import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMarkdownLink, markdownLinkUrls, renderProfileMarkdown } from '../src/markdown.js';
test('markdown: renders the supported inline set', async () => {
  assert.equal(
    await renderProfileMarkdown('**bold** *italic* _also italic_ __underline__ ~~gone~~ `code`'),
    '<p><strong>bold</strong> <em>italic</em> <em>also italic</em> <u class="md-underline">underline</u>'
      + ' <s>gone</s> <code>code</code></p>',
  );
  assert.equal(await renderProfileMarkdown('**bold _mixed_**'), '<p><strong>bold <em>mixed</em></strong></p>');
  assert.equal(await renderProfileMarkdown('2 * 3 * 4 and snake_case_word'), '<p>2 * 3 * 4 and snake_case_word</p>');
  assert.equal(await renderProfileMarkdown('literal \\*stars\\*'), '<p>literal *stars*</p>');
});
test('markdown: renders headings, lists, quotes and paragraphs', async () => {
  assert.equal(
    await renderProfileMarkdown('# Title\n## Smaller\n### Smallest'),
    '<h2>Title</h2><h3>Smaller</h3><h4>Smallest</h4>',
  );
  assert.equal(await renderProfileMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(await renderProfileMarkdown('> quoted\n> still'), '<blockquote><p>quoted<br>still</p></blockquote>');
  assert.equal(
    await renderProfileMarkdown('first\nsecond\n\nthird'),
    '<p>first<br>second</p><p>third</p>',
  );
  assert.equal(await renderProfileMarkdown(''), '');
  assert.equal(await renderProfileMarkdown(null), '');
});
test('markdown: never emits caller HTML or non-HTTPS links', async () => {
  assert.equal(
    await renderProfileMarkdown('<script>alert(1)</script>', { full: true }),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  );
  assert.equal(
    await renderProfileMarkdown('`<b>x</b>`', { full: true }),
    '<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>',
  );
  for (const url of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '/local']) {
    const html = await renderProfileMarkdown(`[label](${url})`, { full: true });
    assert.doesNotMatch(html, /<a /, `${url} must not become a link`);
  }
  assert.equal(
    await renderProfileMarkdown('[a"onmouseover=x](https://example.com/"onmouseover=x)', { full: true }),
    '<p>[a&quot;onmouseover=x](<a href="https://example.com/" rel="noopener noreferrer nofollow">'
      + 'https://example.com/</a>&quot;onmouseover=x)</p>',
    'a quote ends the URL instead of breaking out of the href attribute',
  );
});
test('markdown: links render only at the full level', async () => {
  const source = 'See [my page](https://example.com/me) now.';
  assert.equal(
    await renderProfileMarkdown(source, { full: true }),
    '<p>See <a href="https://example.com/me" rel="noopener noreferrer nofollow">my page</a> now.</p>',
  );
  assert.equal(
    await renderProfileMarkdown(source),
    '<p>See [my page](https://example.com/me) now.</p>',
  );
  assert.equal(
    await renderProfileMarkdown('[**bold link**](https://example.com/)', { full: true }),
    '<p><a href="https://example.com/" rel="noopener noreferrer nofollow"><strong>bold link</strong></a></p>',
  );
  assert.doesNotMatch(await renderProfileMarkdown('bare https://example.com/x'), /<a /, 'the limited level never autolinks');
});
test('markdown: inline text hook wraps only plain runs', async () => {
  const html = await renderProfileMarkdown('mail **person@example.invalid** ok', {
    inlineText: async (value) => `[${value}]`,
  });
  assert.equal(html, '<p>[mail ]<strong>[person@example.invalid]</strong>[ ok]</p>');
});
test('markdown: link helpers report syntax and extract HTTPS targets', () => {
  assert.equal(hasMarkdownLink('a [b](https://example.com) c'), true);
  assert.equal(hasMarkdownLink('a [b](javascript:alert(1)) c'), true, 'rejected syntax still counts as an attempt');
  assert.equal(hasMarkdownLink('plain [brackets] and (parens)'), false);
  assert.deepEqual(
    markdownLinkUrls('[a](https://one.example/x) [b](http://two.example) [c](https://three.example)'),
    ['https://one.example/x', 'https://three.example'],
  );
  assert.deepEqual(markdownLinkUrls(''), []);
});
test('markdown: the limited level ignores full-level syntax', async () => {
  assert.equal(await renderProfileMarkdown('1. one\n2. two'), '<p>1. one<br>2. two</p>');
  assert.equal(await renderProfileMarkdown('---'), '<p>---</p>');
  assert.equal(await renderProfileMarkdown('```\ncode\n```'), '<p>```<br>code<br>```</p>');
  assert.equal(await renderProfileMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |'), '<p>| a | b |<br>| --- | --- |<br>| 1 | 2 |</p>');
  assert.equal(await renderProfileMarkdown('#### deep'), '<h4>deep</h4>', 'deeper headings stop at h4');
  assert.equal(await renderProfileMarkdown('![alt](/static/x.png)'), '<p>![alt](/static/x.png)</p>');
});
test('markdown: the full level renders ordered, nested and fenced blocks', async () => {
  const full = { full: true };
  assert.equal(
    await renderProfileMarkdown('1. one\n2. two', full),
    '<ol><li>one</li><li>two</li></ol>',
  );
  assert.equal(
    await renderProfileMarkdown('3. three\n4. four', full),
    '<ol start="3"><li>three</li><li>four</li></ol>',
  );
  assert.equal(
    await renderProfileMarkdown('- outer\n  - inner\n- second', full),
    '<ul><li>outer<ul><li>inner</li></ul></li><li>second</li></ul>',
  );
  assert.equal(
    await renderProfileMarkdown('```js\nconst x = 1 < 2;\n```', full),
    '<pre tabindex="0" role="region" aria-label="Code block"><code class="language-js">const x = 1 &lt; 2;</code></pre>',
  );
  assert.equal(await renderProfileMarkdown('---', full), '<hr>');
  assert.equal(await renderProfileMarkdown('###### deepest', full), '<h6>deepest</h6>');
});
test('markdown: the full level renders tables with alignment classes', async () => {
  assert.equal(
    await renderProfileMarkdown('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |', { full: true }),
    '<div class="md-table-scroll" tabindex="0" role="region" aria-label="Table"><table><thead><tr><th>a</th><th class="md-center">b</th>'
      + '<th class="md-right">c</th></tr></thead><tbody><tr><td>1</td><td class="md-center">2</td>'
      + '<td class="md-right">3</td></tr></tbody></table></div>',
  );
});
test('markdown: the full level links automatically and allows only site-hosted images', async () => {
  const full = { full: true };
  assert.equal(
    await renderProfileMarkdown('see https://example.com/x.', full),
    '<p>see <a href="https://example.com/x" rel="noopener noreferrer nofollow">https://example.com/x</a>.</p>',
  );
  assert.equal(
    await renderProfileMarkdown('<https://example.com/y>', full),
    '<p><a href="https://example.com/y" rel="noopener noreferrer nofollow">https://example.com/y</a></p>',
  );
  assert.equal(
    await renderProfileMarkdown('![a flag](/static/flags/Queer.png)', full),
    '<p><img src="/static/flags/Queer.png" alt="a flag" loading="lazy"></p>',
  );
  for (const source of ['https://evil.example/x.png', '/etc/passwd', 'javascript:alert(1)']) {
    assert.doesNotMatch(await renderProfileMarkdown(`![x](${source})`, full), /<img /, `${source} must not embed`);
  }
});
test('markdown: the full level still escapes raw HTML', async () => {
  assert.equal(
    await renderProfileMarkdown('<img src=x onerror=alert(1)>\n\n<b>no</b>', { full: true }),
    '<p>&lt;img src=x onerror=alert(1)&gt;</p><p>&lt;b&gt;no&lt;/b&gt;</p>',
  );
});
test('markdown: scrollable blocks are reachable by keyboard', async () => {
  const table = await renderProfileMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |', { full: true });
  assert.match(table, /<div class="md-table-scroll" tabindex="0" role="region" aria-label="Table">/);
  const code = await renderProfileMarkdown('```\nx\n```', { full: true });
  assert.match(code, /<pre tabindex="0" role="region" aria-label="Code block">/);
});
test('markdown: heading levels sit under the section that holds them', async () => {
  assert.equal(await renderProfileMarkdown('# a\n## b\n### c'), '<h2>a</h2><h3>b</h3><h4>c</h4>');
  assert.equal(await renderProfileMarkdown('# a\n## b', { headingOffset: 1 }), '<h3>a</h3><h4>b</h4>');
  assert.equal(await renderProfileMarkdown('### c', { headingOffset: 1 }), '<h5>c</h5>', 'the limited cap moves with the offset');
  assert.equal(await renderProfileMarkdown('###### f', { full: true, headingOffset: 1 }), '<h6>f</h6>', 'nothing goes past h6');
  assert.equal(await renderProfileMarkdown('# a', { headingOffset: 99 }), '<h5>a</h5>', 'a silly offset is clamped');
});
test('markdown: author underline is not styled like a link', async () => {
  assert.equal(await renderProfileMarkdown('__mine__'), '<p><u class="md-underline">mine</u></p>');
  const linked = await renderProfileMarkdown('[label](https://example.com/) and __mine__', { full: true });
  assert.match(linked, /<a href="https:\/\/example\.com\/"[^>]*>label<\/a>/);
  assert.match(linked, /<u class="md-underline">mine<\/u>/);
});
