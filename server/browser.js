import fs from 'node:fs';
import path from 'node:path';
import { IS_WINDOWS } from './config.js';

/**
 * Headless browsing for the agent, via playwright-core driving a
 * Chromium-family browser that is already on the machine (Edge/Chrome).
 * No 150 MB browser download, which keeps the install light.
 */

const WINDOWS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(
    process.env.LOCALAPPDATA || '',
    'Google\\Chrome\\Application\\chrome.exe'
  ),
];

const POSIX_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export function findBrowserExecutable() {
  if (process.env.BROWSER_EXECUTABLE && fs.existsSync(process.env.BROWSER_EXECUTABLE)) {
    return process.env.BROWSER_EXECUTABLE;
  }
  const candidates = IS_WINDOWS ? WINDOWS_CANDIDATES : POSIX_CANDIDATES;
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

let browser = null;
let context = null;
let page = null;
let consoleLog = [];

async function getPage() {
  if (page && !page.isClosed()) return page;
  const exe = findBrowserExecutable();
  if (!exe) {
    throw new Error(
      'No Chromium-family browser found. Install Edge or Chrome, or set BROWSER_EXECUTABLE in .env'
    );
  }
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  page = await context.newPage();
  consoleLog = [];
  page.on('console', (msg) => {
    consoleLog.push({
      type: msg.type(),
      text: msg.text().slice(0, 2000),
      at: Date.now(),
    });
    if (consoleLog.length > 300) consoleLog.shift();
  });
  page.on('pageerror', (err) => {
    consoleLog.push({ type: 'pageerror', text: String(err.message || err), at: Date.now() });
    if (consoleLog.length > 300) consoleLog.shift();
  });
  return page;
}

export function browserStatus() {
  return {
    executable: findBrowserExecutable(),
    running: Boolean(browser),
  };
}

function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fallback when no local browser exists: plain fetch + tag stripping. */
async function fetchFallback(url, maxChars) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'VishSi/1.0 (+local agent)' },
    redirect: 'follow',
  });
  const html = await res.text();
  return {
    engine: 'fetch',
    url: res.url,
    status: res.status,
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim(),
    text: textFromHtml(html).slice(0, maxChars),
    console: [],
  };
}

export async function navigate(
  url,
  { maxChars = 12_000, waitUntil = 'domcontentloaded', screenshot = false } = {}
) {
  let target = url;
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  try {
    const p = await getPage();
    consoleLog = [];
    const resp = await p.goto(target, { waitUntil, timeout: 30_000 });
    const title = await p.title();
    const text = (await p.evaluate(() => document.body?.innerText || '')).slice(0, maxChars);
    const out = {
      engine: 'playwright',
      url: p.url(),
      status: resp ? resp.status() : 0,
      title,
      text,
      console: consoleLog.slice(-50),
    };
    if (screenshot) {
      const buf = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      out.screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
    return out;
  } catch (err) {
    try {
      const fallback = await fetchFallback(target, maxChars);
      fallback.note = `Headless browser unavailable (${err.message}); used plain fetch instead.`;
      return fallback;
    } catch (err2) {
      throw new Error(`Navigation failed: ${err.message} / fetch fallback: ${err2.message}`);
    }
  }
}

export async function inspect(selector, { limit = 10 } = {}) {
  const p = await getPage();
  const nodes = await p.$$eval(
    selector,
    (els, lim) =>
      els.slice(0, lim).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: typeof el.className === 'string' ? el.className : null,
        text: (el.innerText || el.textContent || '').trim().slice(0, 400),
        html: el.outerHTML.slice(0, 1200),
        attrs: Object.fromEntries(
          Array.from(el.attributes).map((a) => [a.name, a.value.slice(0, 200)])
        ),
      })),
    limit
  );
  return { selector, count: nodes.length, nodes, url: p.url() };
}

export async function screenshotPage({ fullPage = false } = {}) {
  const p = await getPage();
  const buf = await p.screenshot({ type: 'jpeg', quality: 65, fullPage });
  return { url: p.url(), dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

export function getConsoleLog() {
  return consoleLog.slice(-100);
}

export async function closeBrowser() {
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  browser = null;
  context = null;
  page = null;
}
