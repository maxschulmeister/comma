import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:4100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "bun run --cwd widget build && bun server/src/index.ts",
      port: 4000,
      reuseExistingServer: !process.env.CI,
    },
    { command: "bun example/app.ts", port: 4100, reuseExistingServer: !process.env.CI },
  ],
})
