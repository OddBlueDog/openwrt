import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The router's web server (uhttpd) can't send cache headers, so browsers may
 * keep an old index.html after a firmware update and ask for bundles that no
 * longer exist. Instead, index.html becomes a loader that never changes: it
 * reads manifest.json (fetched with cache: 'no-store') and loads the bundle
 * it names. The bundles have content hashes, so caching them is fine.
 */
function stableEntry(): Plugin {
  return {
    name: 'milkflint-stable-entry',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (html?.type !== 'asset' || typeof html.source !== 'string') return;
      const js = /<script type="module" crossorigin src="([^"]+)"><\/script>/.exec(html.source);
      const css = [...html.source.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)].map((m) => m[1]);
      if (js?.[1] === undefined) throw new Error('stableEntry: no entry script in index.html');
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify({ js: js[1], css }) });
      const loader = `<script>
      fetch('/milkflint/manifest.json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (m) {
          m.css.forEach(function (href) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = href;
            document.head.appendChild(l);
          });
          var s = document.createElement('script');
          s.type = 'module';
          s.src = m.js;
          document.head.appendChild(s);
        });
    </script>`;
      html.source = html.source
        .replace(js[0], '')
        .replace(/<link rel="stylesheet" crossorigin href="[^"]+">/g, '')
        .replace('</head>', `${loader}\n  </head>`);
    },
  };
}

/**
 * Development only: a stand-in for the test bench's internet load endpoint,
 * so a development run's downloads and uploads stay on this machine
 * instead of loading the internet line. /__bench_dev/down?bytes=N sends N bytes,
 * /__bench_dev/up takes what it's sent, /__bench_dev/ping answers at once.
 * A QEMU test VM reaches it too, at 10.0.2.2 (QEMU's address for its host), so
 * traffic from its pretend devices goes through its WAN and Smart Queue.
 */
function benchDevEndpoint(): Plugin {
  const chunk = Buffer.alloc(64 * 1024, 0x5a);
  return {
    name: 'milkflint-bench-dev-endpoint',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bench_dev', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Timing-Allow-Origin', '*');
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/down') {
          const asked = Number(url.searchParams.get('bytes') ?? 0);
          let left = Number.isFinite(asked) ? Math.min(50_000_000, Math.max(0, asked)) : 0;
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(left) });
          const more = (): void => {
            while (left > 0) {
              const n = Math.min(left, chunk.length);
              left -= n;
              if (!res.write(chunk.subarray(0, n))) {
                res.once('drain', more);
                return;
              }
            }
            res.end();
          };
          req.on('close', () => {
            left = 0;
          });
          more();
        } else if (url.pathname === '/up') {
          let bytes = 0;
          req.on('data', (d: Buffer) => {
            bytes += d.length;
          });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ bytes }));
          });
        } else {
          res.writeHead(204);
          res.end();
        }
      });
    },
  };
}

// The router serves the app from /www/milkflint/ (index page /milkflint.html).
// In development, `pnpm dev` runs it locally and forwards the router API
// (/ubus) and LuCI to a test router or VM: MILKFLINT_VM.
const vm = process.env['MILKFLINT_VM'] ?? 'http://127.0.0.1:8088';

export default defineConfig({
  base: '/milkflint/',
  plugins: [react(), tailwindcss(), stableEntry(), benchDevEndpoint()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5288,
    strictPort: true,
    proxy: {
      '/ubus': { target: vm, changeOrigin: true },
      '/cgi-bin': { target: vm, changeOrigin: true },
      '/luci-static': { target: vm, changeOrigin: true },
      // the test bench's latency probe: the router's own web server, not this one
      '/milkflint/bench-ping': { target: vm, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
