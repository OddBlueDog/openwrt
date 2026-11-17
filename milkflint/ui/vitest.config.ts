// The browser tests (tests/browser, `pnpm test:browser`): components drawn
// in a real Chromium (Vitest's browser mode, through Playwright), styled as
// the app is (Tailwind, the themes' stylesheet, the @ alias), so they're laid
// out as on the router and can be measured. Not the app's whole Vite config:
// its base path, port and proxy to the VM are for `pnpm dev`. The unit tests
// stay on node --test (`pnpm test`).
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { themeStyles } from './vite.config.ts';

export default defineConfig({
  plugins: [themeStyles(), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/browser/**/*.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // wide enough for Home's four columns; each test sizes its own grid
      viewport: { width: 1400, height: 1000 },
    },
  },
});
