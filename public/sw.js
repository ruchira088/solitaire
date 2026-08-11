// Offline support. Hand-written rather than generated: the whole app is ~1.5 MB of
// static files with no API behind it, so a build step and a Workbox dependency would
// buy nothing, and the zero-runtime-dependency rule holds.
//
// The VERSION and PRECACHE placeholders below are substituted at build time by the
// stampServiceWorker plugin in vite.config.ts — which is why neither token is written
// out anywhere else in this file, including in comments: the substitution is a plain
// global replace, and the precache list is multi-line, so a mention inside a `//`
// comment would break out of it and produce a worker that won't parse.
//
// The version is derived from the built asset names, which are content hashes — so a
// changed bundle means a new cache, and
// an unchanged bundle rebuilds to a byte-identical worker rather than evicting
// everyone's cache on a no-op deploy.
//
// Two strategies, chosen for what each thing is:
//
//   - **Navigations go to the network first**, falling back to the cache. index.html
//     is the one unhashed file whose content changes every deploy, so serving it from
//     cache first is exactly how a service worker strands people on a dead bundle.
//     Network-first means an online player always gets the new build; an offline one
//     still gets the last good page. This matters more than usual here because
//     nothing in this repo controls the CloudFront cache headers.
//   - **Everything else is cache-first.** assets/* carry content hashes, so they are
//     immutable by construction; the card art and favicon never change in practice.
//
// The precache list is the shell plus every card face, ~1.5 MB fetched once in the
// background. Precaching only the pip SVGs (mirroring cardFaces.ts's own split) kept
// the install lighter, but a player offline before the court WebPs loaded then got
// procedural faces and a dozen failed requests — worse than the extra 850 KB.

// Every lookup ignores Vary. These are our own static files, whose bytes never differ
// by request header — but a server that sends `Vary: Origin` (Vite's preview does, and
// a CORS-configured CDN may) makes the precached copy unmatchable: cache.add() stores
// a no-cors request with no Origin header, while the browser's real module-script
// request is cors and sends one, so a Vary-respecting match misses every time and the
// app silently fails to load offline.
const MATCH = { ignoreVary: true };

const VERSION = "%SW_VERSION%";
const CACHE = `solitaire-${VERSION}`;
const PRECACHE = %SW_PRECACHE%;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually, so one 404 can't reject the whole install and leave the app
      // with no worker at all.
      await Promise.all(
        PRECACHE.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("solitaire-") && n !== CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch anything off-origin

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          return (
            (await caches.match("./index.html", MATCH)) ||
            (await caches.match(request, MATCH)) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request, MATCH);
      if (hit) return hit;
      const fresh = await fetch(request);
      // Only bank real, complete responses: an opaque or error response cached here
      // would be served back forever.
      if (fresh.ok && fresh.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    })(),
  );
});
