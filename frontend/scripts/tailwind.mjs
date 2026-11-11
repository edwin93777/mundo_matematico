// Shared helper: run the locally installed Tailwind CLI with the project config.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js');

function args(output, extra) {
  if (!existsSync(CLI)) {
    console.error('✖ Tailwind is not installed. Run "npm install" inside frontend/ first.');
    process.exit(1);
  }
  return [CLI, '-c', 'tailwind.config.js', '-i', 'css/app.css', '-o', output, ...extra];
}

/** One-off build (blocking). */
export function buildCss(output, { minify = false } = {}) {
  const r = spawnSync(process.execPath, args(output, minify ? ['--minify'] : []), { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Watch mode ("always": keep watching even when stdin is not a TTY). */
export function watchCss(output) {
  return spawn(process.execPath, args(output, ['--watch=always']), { cwd: ROOT, stdio: 'inherit' });
}
