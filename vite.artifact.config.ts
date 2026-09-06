import { defineConfig } from 'vite';

/**
 * Single-bundle build used to produce a playable web link.
 *
 * Dynamic imports are inlined and assets are embedded so the whole game collapses
 * into one HTML file that can be hosted anywhere, with no relative asset paths to
 * resolve. scripts/build-artifact.mjs turns the output into the final page.
 */
export default defineConfig({
  base: '',
  // Escape every non-ASCII byte. The single-file page carries no <meta charset>
  // of its own — the host supplies the document head — so a bundle containing raw
  // UTF-8 renders the upgrade icons as mojibake wherever the server omits the
  // charset header. ASCII output is correct under any encoding.
  esbuild: { charset: 'ascii' },
  build: {
    target: 'es2020',
    outDir: 'dist-artifact',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
