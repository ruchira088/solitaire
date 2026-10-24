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
    // `npm run test:coverage` only — a report to read, not a gate. A percentage
    // threshold would reward tests written to move a number; what's worth knowing is
    // *which* branches of the untrusted-input parsers nothing exercises. Scoped to the
    // pure modules, the ones this suite is for: the canvas and DOM modules are the
    // smoke test's, and counting them here would only report them as uncovered.
    coverage: {
      provider: "v8",
      include: [
        "src/game.ts",
        "src/cards.ts",
        "src/rng.ts",
        "src/layout.ts",
        "src/storage.ts",
        "src/share.ts",
        "src/statsView.ts",
        "src/cursor.ts",
        "src/solver.ts",
        "src/theme.ts",
        "src/keyboard.ts",
        "src/deadCheck.ts",
        "src/replay.ts",
      ],
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
