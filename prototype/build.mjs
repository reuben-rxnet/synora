// Bundles the prototype into a single self-contained HTML page (React loads from cdnjs).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/index.jsx'],
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
  target: 'es2019',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  legalComments: 'none',
});

const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/styles.css', 'utf8');

const html = `<title>Synora</title>
<meta name="description" content="Synora – Enterprise intelligence, connected. Interactive prototype with demonstration data.">
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&family=Sora:wght@500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/synora.html', html);
// Local preview needs a full document; the artifact host adds its own skeleton.
writeFileSync('dist/preview.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`);
console.log(`dist/synora.html ${(html.length / 1024).toFixed(1)} KB`);
