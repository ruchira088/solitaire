import { defineConfig, Plugin } from "vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fill in the service worker's version and precache list after the bundle is written.
 *
 *  The version is a hash of the emitted asset *names*, which Vite content-hashes — so
 *  a changed bundle produces a new cache name (and `activate` drops the old one),
 *  while an unchanged bundle produces a byte-identical worker rather than evicting
 *  every player's cache on a no-op deploy.
 *
 *  The precache list is the shell plus **every** card face. Leaving the 12 court WebPs
 *  (~850 KB) to be cached on demand kept the install lighter, but meant a player who
 *  went offline before they loaded got procedural faces and a dozen failed requests —
 *  a worse trade than ~1.5 MB fetched once in the background. Files under `public/`
 *  never appear in `bundle`, so the card list is read off disk. */
function stampServiceWorker(): Plugin {
  return {
    name: "stamp-service-worker",
    apply: "build",
    writeBundle(options, bundle) {
      const dir = options.dir ?? "dist";
      const swPath = join(dir, "sw.js");

      const emitted = Object.keys(bundle).sort();
      const version = createHash("sha256").update(emitted.join("|")).digest("hex").slice(0, 12);

      const cards = readdirSync(join(dir, "cards"))
        .sort()
        .map((f) => `./cards/${f}`);

      const precache = [
        "./",
        "./index.html",
        "./favicon.svg",
        "./manifest.webmanifest",
        ...emitted.filter((f) => f.startsWith("assets/")).map((f) => `./${f}`),
        ...cards,
      ];

      const src = readFileSync(swPath, "utf8")
        .replace(/%SW_VERSION%/g, version)
        .replace(/%SW_PRECACHE%/g, JSON.stringify(precache, null, 2));

      // Parse what we're about to ship. A worker that doesn't compile fails silently
      // at runtime — register() just rejects — so the build is the only place this
      // gets noticed. (It has already happened once: a placeholder mentioned in a
      // comment was substituted with the multi-line array and broke out of the `//`.)
      try {
        new Function(src);
      } catch (err) {
        throw new Error(`generated ${swPath} is not valid JavaScript: ${(err as Error).message}`);
      }

      writeFileSync(swPath, src);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [stampServiceWorker()],
  server: {
    open: true,
  },
});
