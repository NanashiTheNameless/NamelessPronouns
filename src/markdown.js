import { escapeHtml } from './util/html.js';
const HEADING = /^(#{1,6})[^\S\n]+(.*)$/;
const BULLET_ITEM = /^([-*+])[^\S\n]+(.*)$/;
const ORDERED_ITEM = /^(\d{1,9})[.)][^\S\n]+(.*)$/;
const QUOTE = /^>[^\S\n]?(.*)$/;
const FENCE = /^```([A-Za-z0-9+#-]{0,20})$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_DIVIDER = /^\|?[\s|:-]*-[\s|:-]*\|?$/;
const LINK = /^\[([^\]\n]+)\]\((https:\/\/[^\s()<>"'`]+)\)/;
const IMAGE = /^!\[([^\]\n]*)\]\((\/static\/[^\s()<>"'`]*)\)/;
const ANGLE_LINK = /^<(https:\/\/[^\s<>"'`]+)>/;
const BARE_LINK = /^https:\/\/[^\s<>"'`]+/;
const LINK_SYNTAX = /\[[^\]\n]*\]\([^)\n]*\)/;
const LINK_URLS = /\[[^\]\n]+\]\((https:\/\/[^\s()<>"'`]+)\)/g;
const ESCAPABLE = new Set(['*', '_', '~', '`', '#', '[', ']', '(', ')', '>', '-', '+', '|', '!', '\\']);
const MARKERS = new Set(['*', '_', '~', '`']);
const WORD_CHARACTER = /[A-Za-z0-9]/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const INLINE_RULES = Object.freeze([
  { pattern: /^\*\*([^\n]+?)\*\*/, tag: 'strong' },
  { pattern: /^__([^\n]+?)__/, tag: 'u', wordEdges: true },
  { pattern: /^~~([^\n]+?)~~/, tag: 's' },
  { pattern: /^\*([^\n]+?)\*/, tag: 'em' },
  { pattern: /^_([^\n]+?)_/, tag: 'em', wordEdges: true },
  { pattern: /^`([^`\n]+?)`/, tag: 'code', literal: true },
]);
const ALIGNMENT_CLASS = Object.freeze({ left: '', center: ' class="md-center"', right: ' class="md-right"' });
async function escapeOnly(value) {
  return escapeHtml(value);
}
function headingTag(level, full) {
  return `h${Math.min(level + 1, full ? 6 : 4)}`;
}
function matchedRule(rest, before) {
  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(rest);
    if (!match) continue;
    if (rule.literal) return { rule, match };
    if (/^\s|\s$/.test(match[1])) continue;
    if (rule.wordEdges && (WORD_CHARACTER.test(before) || WORD_CHARACTER.test(rest[match[0].length] ?? ''))) continue;
    return { rule, match };
  }
  return null;
}
function anchor(url, label) {
  return `<a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${label}</a>`;
}
async function renderInline(text, options) {
  let output = '';
  let plain = '';
  let index = 0;
  const flush = async () => {
    if (plain === '') return;
    output += await options.inlineText(plain);
    plain = '';
  };
  while (index < text.length) {
    const character = text[index];
    if (character === '\\' && ESCAPABLE.has(text[index + 1])) {
      plain += text[index + 1];
      index += 2;
      continue;
    }
    const rest = text.slice(index);
    if (options.full && character === '!') {
      const image = IMAGE.exec(rest);
      if (image) {
        await flush();
        output += `<img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" loading="lazy">`;
        index += image[0].length;
        continue;
      }
    }
    if (options.full && character === '[') {
      const link = LINK.exec(rest);
      if (link) {
        await flush();
        output += anchor(link[2], await renderInline(link[1], { ...options, linked: true }));
        index += link[0].length;
        continue;
      }
    }
    if (options.full && !options.linked && (character === '<' || character === 'h')) {
      const angle = character === '<' ? ANGLE_LINK.exec(rest) : null;
      const bare = angle ? null : BARE_LINK.exec(rest);
      const url = angle ? angle[1] : (bare ? bare[0].replace(TRAILING_PUNCTUATION, '') : null);
      if (url) {
        await flush();
        output += anchor(url, escapeHtml(url));
        index += angle ? angle[0].length : url.length;
        continue;
      }
    }
    const found = MARKERS.has(character) ? matchedRule(rest, text[index - 1] ?? '') : null;
    if (found) {
      const { rule, match } = found;
      await flush();
      output += rule.literal
        ? `<code>${escapeHtml(match[1])}</code>`
        : `<${rule.tag}>${await renderInline(match[1], options)}</${rule.tag}>`;
      index += match[0].length;
      continue;
    }
    plain += character;
    index += 1;
  }
  await flush();
  return output;
}
function indentOf(line) {
  return line.length - line.trimStart().length;
}
function itemAt(line, full) {
  const body = line.trim();
  const bullet = BULLET_ITEM.exec(body);
  if (bullet) return { ordered: false, start: 1, text: bullet[2] };
  const ordered = full ? ORDERED_ITEM.exec(body) : null;
  if (ordered) return { ordered: true, start: Number(ordered[1]), text: ordered[2] };
  return null;
}
function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}
function alignments(divider) {
  return tableCells(divider).map((cell) => {
    if (/^:-+:$/.test(cell)) return 'center';
    if (/^-+:$/.test(cell)) return 'right';
    return 'left';
  });
}
function isTableStart(lines, index, full) {
  return full
    && lines[index].includes('|')
    && typeof lines[index + 1] === 'string'
    && lines[index + 1].includes('|')
    && TABLE_DIVIDER.test(lines[index + 1].trim());
}
function blockStarts(line, full) {
  const body = line.trim();
  if (body === '') return true;
  if (HEADING.test(body) || QUOTE.test(body) || itemAt(line, full)) return true;
  return full && (FENCE.test(body) || RULE.test(body));
}
function collectWhile(lines, index, keep) {
  const collected = [];
  let cursor = index;
  while (cursor < lines.length && keep(lines[cursor])) {
    collected.push(lines[cursor]);
    cursor += 1;
  }
  return { collected, cursor };
}
function dedent(lines, amount) {
  return lines.map((line) => (line.trim() === '' ? '' : line.slice(Math.min(amount, indentOf(line)))));
}
function collectItemLines(lines, index, indent, full) {
  const collected = [lines[index].trim()];
  let cursor = index + 1;
  let pendingBlank = false;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() === '') {
      pendingBlank = true;
      cursor += 1;
      continue;
    }
    const deeper = indentOf(line) > indent;
    const continuation = !pendingBlank && !blockStarts(line, full) && indentOf(line) >= indent;
    if (!deeper && !continuation) break;
    if (pendingBlank) collected.push('');
    pendingBlank = false;
    collected.push(deeper ? line.slice(indent) : line.trim());
    cursor += 1;
  }
  return { collected, cursor };
}
function parseBlocks(lines, full) {
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const body = line.trim();
    if (body === '') {
      index += 1;
      continue;
    }
    if (full && FENCE.test(body)) {
      const language = FENCE.exec(body)[1];
      const { collected, cursor } = collectWhile(lines, index + 1, (next) => !FENCE.test(next.trim()));
      blocks.push({ type: 'code', language, lines: dedent(collected, indentOf(line)) });
      index = cursor + 1;
      continue;
    }
    if (full && RULE.test(body)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }
    const heading = HEADING.exec(body);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (QUOTE.test(body)) {
      const { collected, cursor } = collectWhile(lines, index, (next) => QUOTE.test(next.trim()));
      blocks.push({ type: 'quote', lines: collected.map((next) => QUOTE.exec(next.trim())[1]) });
      index = cursor;
      continue;
    }
    const item = itemAt(line, full);
    if (item) {
      const indent = indentOf(line);
      const list = { type: 'list', ordered: item.ordered, start: item.start, items: [] };
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() === '') {
          const following = lines.slice(index + 1).find((candidate) => candidate.trim() !== '');
          if (!following || indentOf(following) < indent || !itemAt(following, full)) break;
          index += 1;
          continue;
        }
        const nextItem = itemAt(next, full);
        if (!nextItem || indentOf(next) !== indent || nextItem.ordered !== list.ordered) break;
        const gathered = collectItemLines(lines, index, indent, full);
        gathered.collected[0] = nextItem.text;
        list.items.push(gathered.collected);
        index = gathered.cursor;
      }
      blocks.push(list);
      continue;
    }
    if (isTableStart(lines, index, full)) {
      const align = alignments(lines[index + 1]);
      const { collected, cursor } = collectWhile(lines, index + 2, (next) => next.includes('|') && next.trim() !== '');
      blocks.push({ type: 'table', align, header: tableCells(lines[index]), rows: collected.map(tableCells) });
      index = cursor;
      continue;
    }
    const paragraph = [body];
    let cursor = index + 1;
    while (cursor < lines.length && !blockStarts(lines[cursor], full) && !isTableStart(lines, cursor, full)) {
      paragraph.push(lines[cursor].trim());
      cursor += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraph });
    index = cursor;
  }
  return blocks;
}
async function renderBlocks(blocks, options, { tight = false } = {}) {
  const html = [];
  for (const [position, block] of blocks.entries()) {
    if (block.type === 'rule') {
      html.push('<hr>');
      continue;
    }
    if (block.type === 'code') {
      const className = block.language ? ` class="language-${escapeHtml(block.language)}"` : '';
      html.push(`<pre><code${className}>${escapeHtml(block.lines.join('\n'))}</code></pre>`);
      continue;
    }
    if (block.type === 'heading') {
      const tag = headingTag(block.level, options.full);
      html.push(`<${tag}>${await renderInline(block.text, options)}</${tag}>`);
      continue;
    }
    if (block.type === 'quote') {
      html.push(`<blockquote>${await renderBlocks(parseBlocks(block.lines, options.full), options)}</blockquote>`);
      continue;
    }
    if (block.type === 'list') {
      const items = [];
      for (const item of block.items) {
        items.push(`<li>${await renderBlocks(parseBlocks(item, options.full), options, { tight: true })}</li>`);
      }
      const tag = block.ordered ? 'ol' : 'ul';
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
      html.push(`<${tag}${start}>${items.join('')}</${tag}>`);
      continue;
    }
    if (block.type === 'table') {
      const cell = async (text, align, tag) => `<${tag}${ALIGNMENT_CLASS[align] ?? ''}>${await renderInline(text, options)}</${tag}>`;
      const head = [];
      for (const [column, text] of block.header.entries()) head.push(await cell(text, block.align[column], 'th'));
      const rows = [];
      for (const row of block.rows) {
        const cells = [];
        for (const [column, text] of row.entries()) cells.push(await cell(text, block.align[column], 'td'));
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
      html.push(`<div class="md-table-scroll"><table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const lines = [];
    for (const line of block.lines) lines.push(await renderInline(line, options));
    const joined = lines.join('<br>');
    html.push(tight && position === 0 ? joined : `<p>${joined}</p>`);
  }
  return html.join('');
}
export async function renderProfileMarkdown(text, { full = false, inlineText = escapeOnly } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(parseBlocks(lines, full), { full, linked: false, inlineText });
}
export function hasMarkdownLink(text) {
  return LINK_SYNTAX.test(String(text ?? ''));
}
export function markdownLinkUrls(text) {
  return [...String(text ?? '').matchAll(LINK_URLS)].map((match) => match[1]);
}
