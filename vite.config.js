import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// "v.<first 4 letters of the deployed git commit>"
function appVersion() {
  let sha = process.env.WORKERS_CI_COMMIT_SHA || '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = '';
    }
  }
  return sha ? `v.${sha.slice(0, 4)}` : 'v.dev';
}

const version = appVersion();

export default defineConfig({
  build: {
    target: 'es2022',
    manifest: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 1200,
    // AudioWorklet modules must stay real files (no data: URLs).
    assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined),
  },
  plugins: [
    {
      name: 'app-version',
      transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', version),
    },
    {
      // The fancy loading wheel (three.js) is what the page waits for: fetch its chunk with the HTML
      // instead of after the game core has run.
      name: 'preload-loading-wheel',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          const chunk = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.facadeModuleId?.endsWith('render3d/graphics3d.js'));
          if (!chunk) return html;
          return [chunk.fileName, ...chunk.imports].map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', href: `/${f}`, crossorigin: '' }, injectTo: 'head' }));
        },
      },
    },
  ],
  server: { host: true },
  preview: { host: true },
});
