import { defineConfig, devices } from '@playwright/test';

// Local (default): tests the built site in dist/ through e2e/serve.mjs (behaves like GitHub Pages).
//   npm run export:web && npm run test:e2e
// Live site:  E2E_BASE_URL=https://<user>.github.io/HIKE_SAFE/ npm run test:e2e
const live = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: live ?? 'http://localhost:4173/HIKE_SAFE/',
    // A phone-sized window, like the app on the projector.
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: live ? undefined : {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:4173/HIKE_SAFE/',
    reuseExistingServer: true,
  },
});
