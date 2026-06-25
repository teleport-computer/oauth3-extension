import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /e2e\.spec\.ts$/,
  timeout: 90_000,
  reporter: [["list"]],
  outputDir: "/tmp/pw-out",
});
