import { defineConfig, Plugin } from "vite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fill in the service worker's version and precache list after the bundle is written.
 *
 *  The version is a hash of the *contents* of everything shipped. Hashing the emitted
 *  asset names alone was not enough: files under `public/` never appear in `bundle`,
 *  so regenerated card art or a new icon left the version — and the whole worker —
 *  byte-identical, and the cache-first handler went on serving the old copies forever
 *  with no way out short of clearing site data. Contents still hash identically for an
 *  unchanged build, so a no-op deploy does not evict anyone's cache.
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

      /** Every shipped file, relative to dist, except the worker itself — hashing sw.js
       *  into its own version is circular. */
      const shipped = (base: string, prefix = ""): string[] =>
        readdirSync(base, { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory()
              ? shipped(join(base, e.name), `${prefix}${e.name}/`)
              : [`${prefix}${e.name}`],
          )
          .filter((f) => f !== "sw.js")
          .sort();

      const hash = createHash("sha256");
      for (const file of shipped(dir)) {
        hash.update(file);
        hash.update(readFileSync(join(dir, file)));
      }
      const version = hash.digest("hex").slice(0, 12);

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
