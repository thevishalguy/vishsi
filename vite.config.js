import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read PORT out of .env so the dev proxy always points at the same backend
 * port the server actually binds. Vite's own loadEnv only exposes VITE_*
 * variables, so this is read directly.
 */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  const file = path.join(projectDir, '.env');
  if (!fs.existsSync(file)) return undefined;
  let found;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    // Keep scanning: the LAST definition wins, matching the server's loader.
    found = value;
  }
  return found;
}

const API_PORT = Number(envValue('PORT') || 5174);
const UI_PORT = Number(envValue('UI_PORT') || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: UI_PORT,
    // Not strict: if this port is taken, Vite moves to the next free one and
    // prints the URL, rather than refusing to start.
    strictPort: false,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      '/ws': { target: `ws://127.0.0.1:${API_PORT}`, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
