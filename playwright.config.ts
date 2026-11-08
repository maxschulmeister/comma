import { defineConfig, devices } from "@playwright/test"

// Own ports and an in-memory database, so tests do not use the dev servers or their data.
const COMMA_URL = "http://localhost:4800"
const env = {
  COMMA_URL,
  COMMA_SECRET: "e2e-session-secret-0123456789abcdef0123456789",
  COMMA_DB: ":memory:",
  COMMA_CONFIG: "e2e/comma.config.ts",
  EXAMPLE_APP_SECRET: "e2e-app-secret",
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  // Many browsers run at once. Loading the editor and emoji data can take a few seconds.
  expect: { timeout: 10_000 },
  reporter: "list",
  use: { baseURL: "http://localhost:4900", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "bun run --cwd widget build && bun server/src/index.ts",
      url: `${COMMA_URL}/c.js`,
      env: { ...env, PORT: "4800" },
    },
    { command: "bun example/app.ts", url: "http://localhost:4900/", env: { ...env, PORT: "4900" } },
  ],
})
