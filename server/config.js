import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = path.resolve(__dirname, '..');

/** Minimal .env loader (no dotenv dependency). */
function loadDotEnv() {
  const file = path.join(PROJECT_DIR, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const realEnv = { ...process.env };
  const fromFile = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    // Last definition in the file wins (matching dotenv), so a line appended
    // to the bottom of .env overrides the same key set further up.
    fromFile[key] = value;
  }
  for (const [key, value] of Object.entries(fromFile)) {
    // A real environment variable still beats the file.
    if (!(key in realEnv)) process.env[key] = value;
  }
}
loadDotEnv();

export const PORT = Number(process.env.PORT || 5174);
export const UI_PORT = Number(process.env.UI_PORT || 5173);
export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Read the meaningful lines of a plain-text settings file: everything that is
 * not blank and does not start with `#`. Used by api_key.txt and endpoint.txt.
 */
function readSettingLines(file) {
  try {
    if (!file || !fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * The shipped templates contain prompts like "Enter Your API Key here".
 * Treat those (and angle-bracket placeholders) as "not filled in yet", so the
 * fallback chain keeps working instead of sending junk to a provider.
 */
function isPlaceholder(value) {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  if (/^[<[{].*[>\]}]$/.test(v)) return true; // <your-key>, [paste here]
  return /\b(enter|paste|put|your|here|replace|example|xxx+)\b/i.test(v) && /\s/.test(v);
}

function firstLine(file) {
  const value = readSettingLines(file)[0] || '';
  return isPlaceholder(value) ? '' : value;
}

export const KEY_FILE = path.join(PROJECT_DIR, 'api_key.txt');
export const ENDPOINT_FILE = path.join(PROJECT_DIR, 'endpoint.txt');

export const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

/**
 * The key. Re-read on every request, so it can be swapped without a restart.
 * Order: API_KEY env > api_key.txt > API_KEY_FILE env (an external file).
 */
export function getApiKey() {
  if (process.env.API_KEY) return process.env.API_KEY.trim();
  const fromFile = firstLine(KEY_FILE);
  if (fromFile) return fromFile;
  if (process.env.API_KEY_FILE) return firstLine(process.env.API_KEY_FILE);
  return '';
}

/** Where the key currently comes from — shown in /status, never the value. */
export function getApiKeySource() {
  if (process.env.API_KEY) return 'API_KEY env';
  if (firstLine(KEY_FILE)) return 'api_key.txt';
  if (process.env.API_KEY_FILE && firstLine(process.env.API_KEY_FILE)) {
    return `API_KEY_FILE (${process.env.API_KEY_FILE})`;
  }
  return 'none';
}

/**
 * The endpoint. Order: endpoint.txt line 1 > BASE_URL env > default.
 * A second non-comment line in endpoint.txt, if present, is a default model id.
 */
export function getBaseUrl() {
  const fromFile = firstLine(ENDPOINT_FILE);
  // Only accept something that is actually a URL; a half-edited template
  // should fall through rather than produce an unusable endpoint.
  if (/^https?:\/\/\S+$/i.test(fromFile)) return fromFile.replace(/\/+$/, '');
  return process.env.BASE_URL || DEFAULT_BASE_URL;
}

export function getModel() {
  const lines = readSettingLines(ENDPOINT_FILE);
  const fromFile = lines[1];
  if (fromFile && !isPlaceholder(fromFile)) return fromFile;
  return process.env.MODEL || DEFAULT_MODEL;
}

/**
 * Anthropic's API is not OpenAI-compatible, so the provider follows the
 * endpoint unless PROVIDER is set explicitly.
 */
export function getProvider() {
  if (process.env.PROVIDER) return process.env.PROVIDER.toLowerCase();
  return /(^|\.)anthropic\.com/i.test(getBaseUrl()) ? 'anthropic' : 'openai';
}

// Getters, so /api/status always reflects what the files say right now.
export const DEFAULTS = {
  get provider() {
    return getProvider();
  },
  get baseUrl() {
    return getBaseUrl();
  },
  get model() {
    return getModel();
  },
};

/** Models offered in the UI dropdown; a custom id can also be typed. */
export const MODEL_PRESETS = [
  // Verified present on the NVIDIA NIM catalogue for this key on 2026-11-17
  // and confirmed to emit OpenAI-style tool calls. `GET {baseUrl}/models`
  // lists what a given key can actually reach — ids change over time.
  {
    id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    label: 'Nemotron 3.5 Lightning 30B (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'poolside/laguna-xs-2.1',
    label: 'Poolside Laguna XS 2.1 — coding (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'minimaxai/minimax-m3.1-flash',
    label: 'MiniMax M3.1 Flash (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'mistralai/mistral-large-4-1t-a52b',
    label: 'Mistral Large 4 (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    label: 'Nemotron 3 Ultra 550B (NVIDIA)',
    provider: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5 (Anthropic key)',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o mini (OpenAI key)',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
  },
];

export const DEFAULT_WORKSPACE =
  process.env.WORKSPACE_ROOT && fs.existsSync(process.env.WORKSPACE_ROOT)
    ? path.resolve(process.env.WORKSPACE_ROOT)
    : PROJECT_DIR;

export const HOME_DIR = os.homedir();
export const IS_WINDOWS = process.platform === 'win32';
