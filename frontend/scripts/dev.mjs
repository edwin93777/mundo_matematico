// Local development: compile Tailwind once, keep watching it, and serve the app.
//   npm run dev  →  http://localhost:5173  (expects the API on http://localhost:5000)
import { spawn } from 'node:child_process';
import { ROOT, buildCss, watchCss } from './tailwind.mjs';

buildCss('css/tailwind.css'); // ensure the stylesheet exists before the first request

const css = watchCss('css/tailwind.css');
css.on('exit', (code) => { if (code) console.warn(`Tailwind watcher stopped (code ${code}); CSS will not auto-rebuild.`); });

const web = spawn(process.execPath, ['serve.mjs'], { cwd: ROOT, stdio: 'inherit' });
web.on('exit', (code) => { css.kill(); process.exit(code ?? 0); });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { css.kill(); web.kill(); process.exit(0); });
}
