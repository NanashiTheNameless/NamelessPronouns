import { readFile } from 'node:fs/promises';
const DOCUMENTS = Object.freeze({
  terms: new URL('../docs/legal/TERMS.md', import.meta.url),
  privacy: new URL('../docs/legal/PRIVACY.md', import.meta.url),
});
export function parseLegalMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let title = '';
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ type: 'list', items: list });
    list = null;
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      if (level === 1 && !title) title = heading[2].trim();
      else blocks.push({ type: 'heading', level: Math.min(level, 3), text: heading[2].trim() });
      continue;
    }
    const item = /^-\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      if (!list) list = [];
      list.push(item[1].trim());
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list?.length) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (!title) throw new Error('Legal document requires one level-one title.');
  return { title, blocks };
}
const cache = new Map();
export async function loadLegalDocument(name) {
  const url = DOCUMENTS[name];
  if (!url) throw new Error(`Unknown legal document: ${name}`);
  if (!cache.has(name)) {
    cache.set(name, readFile(url, 'utf8').then(parseLegalMarkdown));
  }
  return cache.get(name);
}
