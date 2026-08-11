import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsHtmlTag, sanitizeHtml, sanitizeTag, stripDangerousElements } from '../src/html-sanitize.js';
test('sanitizer keeps ordinary markup', () => {
  assert.equal(
    sanitizeHtml('<div><p>Hello <strong>there</strong></p><ul><li>one</li></ul></div>'),
    '<div><p>Hello <strong>there</strong></p><ul><li>one</li></ul></div>',
  );
  assert.equal(sanitizeHtml('<table><tr><th scope="col">a</th><td colspan="2">b</td></tr></table>'),
    '<table><tr><th scope="col">a</th><td colspan="2">b</td></tr></table>');
  assert.equal(sanitizeHtml('<details open><summary>More</summary><p>body</p></details>'),
    '<details open><summary>More</summary><p>body</p></details>');
});
test('sanitizer removes everything that could execute unless code is permitted', () => {
  assert.equal(sanitizeHtml('<script>alert(1)</script>ok'), 'ok');
  assert.equal(sanitizeHtml('<p onclick="alert(1)">text</p>'), '<p>text</p>');
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), 'x');
  assert.equal(sanitizeHtml('<a href="data:text/html,<script>">x</a>'), 'x');
  assert.equal(sanitizeHtml('<img src="x" onerror="alert(1)">'), '');
  assert.equal(sanitizeHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>'),
    '<iframe referrerpolicy="no-referrer" loading="lazy"></iframe>');
  assert.equal(sanitizeHtml('<form action="/x"><button>go</button></form>'), '');
  assert.equal(sanitizeHtml('<object data="https://x.example/f.swf"></object>'), '');
  assert.equal(sanitizeHtml('<svg><use href="#x"/></svg>'), '');
  assert.equal(sanitizeHtml('<p style="position:fixed;inset:0">covered</p>'), '<p>covered</p>');
});
test('code is kept only when the caller permits it', () => {
  const code = { allowCode: true };
  assert.equal(sanitizeHtml('<script>if (a < b) go("x")</script>', code), '<script>if (a < b) go("x")</script>',
    'script bodies are passed through untouched, not escaped');
  assert.equal(sanitizeHtml('<button onclick="go()">g</button>', code), '<button onclick="go()">g</button>');
  assert.equal(sanitizeHtml('<a href="javascript:go()">r</a>', code),
    '<a href="javascript:go()" rel="noopener noreferrer nofollow">r</a>');
  assert.equal(sanitizeHtml('<form action="https://f.example/s" method="post"><input name="q"><button>go</button></form>', code),
    '<form action="https://f.example/s" method="post"><input name="q"><button>go</button></form>');
  assert.equal(sanitizeHtml('<object data="https://o.example/a.pdf" type="application/pdf"></object>', code),
    '<object data="https://o.example/a.pdf" type="application/pdf"></object>');
  assert.equal(sanitizeHtml('<embed src="https://o.example/a.swf">', code), '<embed src="https://o.example/a.swf">');
  assert.equal(sanitizeHtml('<style>body{display:none}</style>ok', code), 'ok', 'restyling the site stays out at every level');
  assert.equal(sanitizeHtml('<p style="color:red">x</p>', code), '<p>x</p>');
  assert.equal(sanitizeHtml('<a href="vbscript:x">y</a>', code), 'y', 'only javascript, https, and site paths are addresses');
  assert.equal(sanitizeTag('<script>', code), '<script>');
  assert.equal(sanitizeTag('<script>'), '', 'the strict mode still refuses it');
  assert.equal(stripDangerousElements('a<script>go()</script>b', { allowCode: true }), 'a<script>go()</script>b');
  assert.equal(stripDangerousElements('a<script>go()</script>b'), 'ab');
});
test('sanitizer allows remote media over HTTPS only', () => {
  assert.equal(sanitizeHtml('<img src="https://cdn.example/a.png" alt="a">'),
    '<img src="https://cdn.example/a.png" alt="a" loading="lazy">');
  assert.equal(sanitizeHtml('<img src="/static/flags/Queer.png" alt="flag">'),
    '<img src="/static/flags/Queer.png" alt="flag" loading="lazy">');
  assert.equal(sanitizeHtml('<img src="http://cdn.example/a.png" alt="a">'), '', 'plain HTTP is refused');
  assert.equal(sanitizeHtml('<img src="//cdn.example/a.png">'), '', 'protocol-relative is refused');
  assert.equal(sanitizeHtml('<video src="https://cdn.example/v.mp4" controls muted></video>'),
    '<video src="https://cdn.example/v.mp4" controls muted></video>');
  assert.match(sanitizeHtml('<iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe>'),
    /^<iframe src="https:\/\/www\.youtube\.com\/embed\/x" allowfullscreen referrerpolicy="no-referrer" loading="lazy"><\/iframe>$/);
});
test('sanitizer hardens links and balances tags', () => {
  assert.equal(sanitizeHtml('<a href="https://x.example" target="_self">x</a>'),
    '<a href="https://x.example" target="_blank" rel="noopener noreferrer nofollow">x</a>');
  assert.equal(sanitizeHtml('<div><p>unclosed'), '<div><p>unclosed</p></div>');
  assert.equal(sanitizeHtml('</p></div>stray'), 'stray');
  assert.equal(sanitizeHtml('a < b and 3>2'), 'a &lt; b and 3&gt;2');
});
test('single tags and dangerous blocks are handled on their own', () => {
  assert.equal(sanitizeTag('<strong>'), '<strong>');
  assert.equal(sanitizeTag('</strong>'), '</strong>');
  assert.equal(sanitizeTag('<blink>'), '');
  assert.equal(sanitizeTag('<script src="https://x.example/a.js">'), '');
  assert.equal(sanitizeTag('<img src="https://x.example/a.png">'), '<img src="https://x.example/a.png" loading="lazy">');
  assert.equal(stripDangerousElements('a<script>evil()</script>b'), 'ab');
  assert.equal(stripDangerousElements('a<style>body{display:none}</style>b'), 'ab');
  assert.equal(containsHtmlTag('<p>x</p>'), true);
  assert.equal(containsHtmlTag('a < b'), false);
});
