import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export const CHROMIUM = process.env.CHROMIUM_PATH || '/snap/bin/chromium';
export const HEADLESS_FLAGS = Object.freeze([
  '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
]);
export class ChromiumMissing extends Error {}
export async function dumpDom(args, { timeout = 60000, maxBuffer = 4 * 1024 * 1024, attempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { stdout } = await run(CHROMIUM, [...HEADLESS_FLAGS, ...args], { timeout, maxBuffer, encoding: 'utf8' });
      return stdout;
    } catch (error) {
      if (error.code === 'ENOENT') throw new ChromiumMissing('Chromium is not installed');
      lastError = error;
    }
  }
  throw lastError;
}
export async function dumpMatching(args, pattern, options = {}) {
  const { attempts = 3, ...rest } = options;
  let last = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await dumpDom(args, { ...rest, attempts: 1 });
    if (pattern.test(last)) return last;
  }
  return last;
}
export async function dumpHarness(args, options = {}) {
  const { attempts = 3, ...rest } = options;
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const html = await dumpDom(args, { ...rest, attempts: 1 });
    last = html;
    const result = harnessResult(html);
    if (result !== null) return { html, result };
  }
  return { html: last, result: null };
}
export function harnessResult(html) {
  const encoded = /<output id="browser-result">([^<]+)<\/output>/.exec(html)?.[1];
  if (!encoded || encoded === 'pending') return null;
  return JSON.parse(encoded
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&'));
}
