/**
 * Collapses the production build into a single self-contained HTML page.
 *
 * The output has no <html>, <head> or <body> tags: it is a page body plus its own
 * <title>, <style> and <script>, which is the shape the Artifact host expects and
 * which also drops straight into any static host.
 *
 *   npm run build:web
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'dist-artifact';
const TARGET = 'artifact/roblaksim-survivor.html';

console.log('Building single-file web bundle…');
execSync('npx vite build --config vite.artifact.config.ts', { stdio: 'inherit' });

const assetDir = join(OUT_DIR, 'assets');
const files = readdirSync(assetDir);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile) throw new Error('no js bundle produced');

const js = readFileSync(join(assetDir, jsFile), 'utf8');
const css = cssFile ? readFileSync(join(assetDir, cssFile), 'utf8') : '';

// A closing </script> anywhere inside the bundle would end the inline script early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const page = `<title>Roblaksim Survivor</title>
<style>
${css}
</style>

<div id="app"></div>

<script type="module">
${safeJs}
</script>
`;

mkdirSync('artifact', { recursive: true });
writeFileSync(TARGET, page);
console.log(`\n${TARGET}  ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB`);
