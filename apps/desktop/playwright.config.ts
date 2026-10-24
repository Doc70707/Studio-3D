import { defineConfig, devices } from "@playwright/test";

// Runs the built interface in Chromium (the same engine family as Windows WebView2).
export default defineConfig({
  testDir: "e2e",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Rebuilds run the real geometry engine in WebAssembly beside software-rendered WebGL. With two test workers
  // and thread builds taking seconds, 5 s is too tight for "the model is up to date", so allow 15 s.
  expect: { timeout: 15_000 },
  // CI's shared machines vary: the same run has been half as fast again from one day to the next, and the longer
  // tests (drawing, restarting, threads) take 20-28 s on a good day. 60 s each keeps a slow machine from failing them.
  timeout: 60_000,
  // A failed test keeps a trace (in the HTML report on CI), so a rare failure can be looked at afterwards.
  // Tests run with the system's "reduce motion" setting, so the camera and panels jump instead of gliding and each
  // check sees the final state at once. The glides themselves are tested with motion on (e2e/motion.spec.ts).
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    // Every test starts in Advanced mode, with every tool in view, unless it says otherwise; the first-start chooser
    // and the other modes have their own tests (e2e/experience.spec.ts).
    storageState: {
      cookies: [],
      origins: [
        { origin: "http://localhost:4173", localStorage: [{ name: "studio3d.experience", value: "advanced" }] },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
      },
    },
  ],
  webServer: { command: "npm run preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI },
});
