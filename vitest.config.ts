import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts on purpose: `defineConfig` imported from "vite"
// doesn't type a `test` key, and merging them would put test config on the path of
// every production build. There are no Vite plugins here to inherit.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The pure modules under test touch no DOM; storage.test.ts stubs the one
    // global it needs, which keeps jsdom out of the dependency tree.
    environment: "node",
  },
});
