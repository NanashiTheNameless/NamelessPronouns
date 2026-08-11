import { escapeHtml } from './util/html.js';
import { BLOCK_TAGS, HTML_TAG_TOKEN, sanitizeTag, stripDangerousElements } from './html-sanitize.js';
const HEADING = /^(#{1,6})[^\S\n]+(.*)$/;
const BULLET_ITEM = /^([-*+])[^\S\n]+(.*)$/;
const ORDERED_ITEM = /^(\d{1,9})[.)][^\S\n]+(.*)$/;
const QUOTE = /^>[^\S\n]?(.*)$/;
const FENCE = /^```([A-Za-z0-9+#-]{0,20})$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_DIVIDER = /^\|?[\s|:-]*-[\s|:-]*\|?$/;
const URL_TARGET = '(?:https:\\/\\/|\\/)[^\\s()<>"\'`]*';
const LINK = new RegExp(`^\\[([^\\]\\n]+)\\]\\(\\s*<?(${URL_TARGET})>?\\s*\\)`);
const IMAGE = new RegExp(`^!\\[([^\\]\\n]*)\\]\\(\\s*<?(${URL_TARGET})>?\\s*\\)`);
const FOOTNOTE_REFERENCE = /^\[\^([A-Za-z0-9_-]{1,32})\](?!:)/;
const FOOTNOTE_DEFINITION = /^\[\^([A-Za-z0-9_-]{1,32})\]:[^\S\n]*(.*)$/;
const TASK_ITEM = /^([-*+])[^\S\n]+\[([ xX])\][^\S\n]+(.*)$/;
const DEFINITION = /^:[^\S\n]+(.*)$/;
const ANGLE_LINK = /^<(https:\/\/[^\s<>"'`]+)>/;
const BARE_LINK = /^https:\/\/[^\s<>"'`]+/;
const LINK_SYNTAX = /\[[^\]\n]*\]\([^)\n]*\)/;
const LINK_URLS = /\[[^\]\n]+\]\(\s*<?(https:\/\/[^\s()<>"'`]+)>?\s*\)/g;
const ESCAPABLE = new Set(['*', '_', '~', '`', '#', '[', ']', '(', ')', '>', '-', '+', '|', '!', '\\']);
const MARKERS = new Set(['*', '_', '~', '`']);
const WORD_CHARACTER = /[A-Za-z0-9]/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const INLINE_RULES = Object.freeze([
  { pattern: /^\*\*([^\n]+?)\*\*/, tag: 'strong' },
  { pattern: /^__([^\n]+?)__/, tag: 'u', className: 'md-underline', wordEdges: true },
  { pattern: /^~~([^\n]+?)~~/, tag: 's' },
  { pattern: /^\*([^\n]+?)\*/, tag: 'em' },
  { pattern: /^_([^\n]+?)_/, tag: 'em', wordEdges: true },
  { pattern: /^`([^`\n]+?)`/, tag: 'code', literal: true },
]);
const ALIGNMENT_CLASS = Object.freeze({ left: '', center: ' class="md-center"', right: ' class="md-right"' });
async function escapeOnly(value) {
  return escapeHtml(value);
}
function slugFor(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'section';
}
function headingTag(level, { full, headingOffset }) {
  const base = 2 + headingOffset;
  const deepest = Math.min(6, full ? 6 : base + 2);
  return `h${Math.min(base + level - 1, deepest)}`;
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
    if (options.full && character === '[') {
      const reference = FOOTNOTE_REFERENCE.exec(rest);
      if (reference && options.footnotes?.definitions.has(reference[1])) {
        const id = reference[1];
        if (!options.footnotes.order.includes(id)) options.footnotes.order.push(id);
        const number = options.footnotes.order.indexOf(id) + 1;
        await flush();
        output += `<sup class="md-footnote-ref" id="md-fnref-${escapeHtml(id)}">`
          + `<a href="#md-fn-${escapeHtml(id)}" aria-label="Footnote ${number}">${number}</a></sup>`;
        index += reference[0].length;
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
    if (options.full && character === '<') {
      const token = HTML_TAG_TOKEN.exec(rest);
      if (token) {
        await flush();
        output += sanitizeTag(token[0]);
        index += token[0].length;
        continue;
      }
    }
    const found = MARKERS.has(character) ? matchedRule(rest, text[index - 1] ?? '') : null;
    if (found) {
      const { rule, match } = found;
      await flush();
      const attributes = rule.className ? ` class="${rule.className}"` : '';
      output += rule.literal
        ? `<code>${escapeHtml(match[1])}</code>`
        : `<${rule.tag}${attributes}>${await renderInline(match[1], options)}</${rule.tag}>`;
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
  const task = full ? TASK_ITEM.exec(body) : null;
  if (task) return { ordered: false, start: 1, text: task[3], checked: task[2].toLowerCase() === 'x' };
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
function htmlBlockAt(line, full) {
  if (!full) return null;
  const body = line.trim();
  if (!body.startsWith('<')) return null;
  const token = HTML_TAG_TOKEN.exec(body);
  if (!token) return null;
  const tag = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(token[0])[1].toLowerCase();
  return BLOCK_TAGS.has(tag) ? tag : null;
}
function blockStarts(line, full) {
  const body = line.trim();
  if (body === '') return true;
  if (HEADING.test(body) || QUOTE.test(body) || itemAt(line, full)) return true;
  if (full && (DEFINITION.test(body) || htmlBlockAt(line, full))) return true;
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
    const htmlTag = htmlBlockAt(line, full);
    if (htmlTag) {
      const collected = [body];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].trim() !== '') {
        collected.push(lines[cursor].trim());
        cursor += 1;
      }
      blocks.push({ type: 'html', lines: collected });
      index = cursor;
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
      const list = { type: 'list', ordered: item.ordered, start: item.start, items: [], checks: [] };
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
        list.checks.push(nextItem.checked);
        index = gathered.cursor;
      }
      blocks.push(list);
      continue;
    }
    if (full && !DEFINITION.test(body) && index + 1 < lines.length && DEFINITION.test(lines[index + 1].trim())) {
      const entries = [];
      let cursor = index;
      while (cursor < lines.length) {
        const term = lines[cursor].trim();
        if (term === '' || DEFINITION.test(term) || blockStarts(lines[cursor], full)) break;
        if (!(cursor + 1 < lines.length && DEFINITION.test(lines[cursor + 1].trim()))) break;
        const definitions = [];
        cursor += 1;
        while (cursor < lines.length && DEFINITION.test(lines[cursor].trim())) {
          definitions.push(DEFINITION.exec(lines[cursor].trim())[1]);
          cursor += 1;
        }
        entries.push({ term, definitions });
      }
      if (entries.length) {
        blocks.push({ type: 'definitions', entries });
        index = cursor;
        continue;
      }
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
      html.push(
        '<pre tabindex="0" role="region" aria-label="Code block">'
        + `<code${className}>${escapeHtml(block.lines.join('\n'))}</code></pre>`,
      );
      continue;
    }
    if (block.type === 'heading') {
      const tag = headingTag(block.level, options);
      const label = await renderInline(block.text, options);
      if (!options.full) {
        html.push(`<${tag}>${label}</${tag}>`);
        continue;
      }
      const slug = `md-${slugFor(block.text)}`;
      html.push(`<${tag} id="${slug}">${label}`
        + ` <a class="md-anchor" href="#${slug}" aria-label="Link to this heading">#</a></${tag}>`);
      continue;
    }
    if (block.type === 'html') {
      const lines = [];
      for (const line of block.lines) lines.push(await renderInline(line, options));
      html.push(lines.join('\n'));
      continue;
    }
    if (block.type === 'definitions') {
      const entries = [];
      for (const entry of block.entries) {
        entries.push(`<dt>${await renderInline(entry.term, options)}</dt>`);
        for (const definition of entry.definitions) {
          entries.push(`<dd>${await renderInline(definition, options)}</dd>`);
        }
      }
      html.push(`<dl class="md-definitions">${entries.join('')}</dl>`);
      continue;
    }
    if (block.type === 'quote') {
      html.push(`<blockquote>${await renderBlocks(parseBlocks(block.lines, options.full), options)}</blockquote>`);
      continue;
    }
    if (block.type === 'list') {
      const items = [];
      for (const [position, item] of block.items.entries()) {
        const content = await renderBlocks(parseBlocks(item, options.full), options, { tight: true });
        const checked = block.checks?.[position];
        if (checked === undefined) {
          items.push(`<li>${content}</li>`);
          continue;
        }
        items.push(`<li class="md-task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${content}</li>`);
      }
      const tag = block.ordered ? 'ol' : 'ul';
      const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : '';
      const className = block.checks?.some((value) => value !== undefined) ? ' class="md-tasks"' : '';
      html.push(`<${tag}${start}${className}>${items.join('')}</${tag}>`);
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
      html.push(
        '<div class="md-table-scroll" tabindex="0" role="region" aria-label="Table">'
        + `<table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`,
      );
      continue;
    }
    const lines = [];
    for (const line of block.lines) lines.push(await renderInline(line, options));
    const joined = lines.join('<br>');
    if (joined.trim() === '') continue;
    html.push(tight && position === 0 ? joined : `<p>${joined}</p>`);
  }
  return html.join('');
}
async function renderFootnotes(footnotes, options) {
  if (!footnotes.order.length) return '';
  const items = [];
  for (const [position, id] of footnotes.order.entries()) {
    const body = await renderInline(footnotes.definitions.get(id), options);
    items.push(`<li id="md-fn-${escapeHtml(id)}">${body}`
      + ` <a href="#md-fnref-${escapeHtml(id)}" aria-label="Back to reference ${position + 1}">&#8617;</a></li>`);
  }
  return `<section class="md-footnotes" aria-label="Footnotes"><ol>${items.join('')}</ol></section>`;
}
export async function renderProfileMarkdown(text, { full = false, headingOffset = 0, inlineText = escapeOnly } = {}) {
  const source = full ? stripDangerousElements(text) : String(text ?? '');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const footnotes = { order: [], definitions: new Map() };
  const body = [];
  for (const line of lines) {
    const definition = full ? FOOTNOTE_DEFINITION.exec(line.trim()) : null;
    if (definition) {
      footnotes.definitions.set(definition[1], definition[2]);
      continue;
    }
    body.push(line);
  }
  const options = {
    full,
    headingOffset: Math.max(0, Math.min(3, Number(headingOffset) || 0)),
    linked: false,
    inlineText,
    footnotes,
  };
  const rendered = await renderBlocks(parseBlocks(body, full), options);
  return rendered + await renderFootnotes(footnotes, options);
}
export function hasMarkdownLink(text) {
  return LINK_SYNTAX.test(String(text ?? ''));
}
export function markdownLinkUrls(text) {
  return [...String(text ?? '').matchAll(LINK_URLS)].map((match) => match[1]);
}
