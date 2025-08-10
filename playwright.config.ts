import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: false,
    env: {
      E2E_ENABLE: '1',
      // 前端调参：缩短空闲与总时长，提升 E2E 速度与确定性
      NEXT_PUBLIC_SSE_IDLE_MS: '1500',
      NEXT_PUBLIC_TOTAL_TIMEOUT_MS: '5000',
      NEXT_PUBLIC_BASE_DELAY_MS: '300',
      NEXT_PUBLIC_BACKOFF_MIN_MS: '200',
      NEXT_PUBLIC_BACKOFF_MAX_MS: '1000',
      NEXT_PUBLIC_MAX_RETRIES: '20',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
