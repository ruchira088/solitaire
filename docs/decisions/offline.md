<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Offline: the service worker

Hand-written, two strategies, and one rule that is easy to undo by accident.

- **Offline is a service worker with two strategies, and one non-obvious rule.**
  `public/sw.js` is hand-written (no Workbox — the zero-runtime-dependency rule).
  **Navigations are network-first**, because `index.html` is the one unhashed file
  that changes every deploy and cache-first on it is exactly how a worker strands
  people on a dead bundle; everything else is cache-first, since `assets/*` are
  content-hashed and the card art never changes. The non-obvious rule: **every lookup
  passes `ignoreVary: true`.** `cache.add()` precaches a `no-cors` request with no
  `Origin` header while the browser's real module-script request is `cors` and sends
  one, so against a server that emits `Vary: Origin` (Vite's preview does, and a
  CORS-configured CDN may) a Vary-respecting match misses every time and the app
  silently fails to load offline. `stampServiceWorker` in `vite.config.ts` fills in
  the cache version (a hash of the emitted asset names, so an unchanged bundle
  rebuilds byte-identically rather than evicting everyone) and the precache list, then
  **parses the result and fails the build if it isn't valid JavaScript** — a worker
  that doesn't compile only shows up as a rejected `register()`, which the app
  swallows on purpose. For the same reason neither placeholder token appears anywhere
  else in `sw.js`, comments included: the substitution is a global replace and the
  multi-line precache array would break out of a `//`.
