# URL Source Proxy Design

## Problem
Today the danmaku server only accepts a **local HTML file** as its source: `node server.js <file.html>` reads the file once with `fs.readFileSync` ([server.js:13-24](../../../server.js#L13-L24)) and serves that single injected page. The user wants to point the server at an **already-running local HTTP service** — e.g. `node server.js http://localhost:8787/` — and share *that* page (with the danmaku layer on top) to the LAN/public, instead of a static file.

The concrete target is **Hermes WebUI** (`localhost:8787`). Hermes is a server-rendered, multi-file vanilla-JS web app with its own backend API (`/api/*`), an xterm terminal, and PWA support — not a slide deck. This changes the work from "read a file" to "become a transparent reverse proxy that injects the danmaku layer into the upstream's HTML responses."

## Goal
- `node server.js http://localhost:8787` mounts the upstream service transparently through the danmaku server: HTML responses get the danmaku layer injected; all other requests (static assets, API, sessions) are proxied to the upstream.
- The audience opens the **same Hermes session URL** (e.g. `http://<bullet-server>/session/<id>`) as the speaker and sees the same session view, with danmaku floating on top.
- File mode (`node server.js <file.html>`) is unchanged — fully backwards compatible.
- Public sharing (Cloudflare Tunnel) in URL mode is **opt-in** with a loud warning, because the upstream is an interactive agent+terminal (RCE-class exposure if exposed publicly).

## Non-goals
- We do **not** build any new state-sync of the upstream app. Whether multiple viewers of a Hermes session see live updates is a property of Hermes itself; the transparent proxy preserves whatever Hermes does for multiple clients on the same session.
- We do **not** mirror the speaker's screen. There is no DOM/screenshare broadcast.
- File-mode behavior (auto public tunnel, full slide-sync/anim-sync injection) is untouched.

## Background — Hermes WebUI findings
Inspected by loading `http://localhost:8787/` and reading the served HTML (178 KB, `text/html`):

- **Multi-file server-rendered app**, not a framework SPA. ~22 relative `static/…` asset references (`ui.js`, `style.css`, `terminal.js`, …) plus a few absolute CDN refs (jsdelivr: prismjs, xterm, katex). **Zero** absolute `localhost` references in the source.
- **`<base href>` is computed at runtime** from `location.origin` + pathname via an inline `document.write` script. The HTML comment states: *"base href enables subpath mount support; all static paths must stay relative (no leading slash)."* → Hermes is **designed for cross-origin / subpath mounting**. When served through the proxy, the base resolves to the bullet-server origin, so all relative refs proxy correctly. **We must not strip or rewrite this tag.**
- **No Socket.IO, no persistent WebSocket on the main page.** Live updates use HTTP polling (`/api/health/agent`, `/api/crons/recent?since=…`) and (presumed) streaming HTTP for agent responses. Only the optional **xterm terminal** is expected to use a WebSocket.
- `/api/*` returns **200 with no auth** (csrfToken empty). Combined with the terminal, this is why public exposure is dangerous.
- Registers a **PWA service worker** + manifest. A SW registered on the bullet-server origin would cache non-injected HTML and must be neutralized.

## Design

### 1. Mode detection & CLI
- In [server.js](../../../server.js), inspect `argv[2]`: if it starts with `http://` or `https://`, enter **URL/proxy mode**; otherwise keep the existing file mode.
- The argument is the **upstream origin** (scheme + host + port) only: `node server.js http://localhost:8787`. The proxy forwards the incoming request path verbatim, so bullet-server becomes a transparent mount of Hermes. To share a specific session, the speaker shares `http://<bullet-server>/session/<id>` (mirroring Hermes's own URL structure).
- A constant like `UPSTREAM_ORIGIN` (string) / `SOURCE_MODE` (`'file' | 'url'`) replaces the single `HTML_FILE` assumption.

### 2. Routing precedence
bullet-server owns the following paths; **everything else proxies to the upstream**:

| Path | Served by | Notes |
|---|---|---|
| `/public/*` | bullet-server static | Injected danmaku assets ([server.js:30](../../../server.js#L30)) |
| `/socket.io/*` | bullet-server Socket.IO | Realtime danmaku (upstream has none) |
| `/speaker`, `/moderator`, `/audience` | bullet-server entry routes | Fetch upstream root + inject role. `/speaker` and `/moderator` **set the role cookie** (see §4); `/audience` injects the audience role (no cookie) |
| everything else (`/`, `/static/*`, `/api/*`, `/session/*`, `manifest.json`, …) | **proxy → `:8787`** | `text/html` responses are injected; all else passes through |

Hermes's paths (`/api`, `/static`, `/session`, `manifest.json`, …) do not collide with `/public`, `/socket.io`, `/speaker`, `/moderator`, `/audience` — verified against the served page.

### 3. Reverse proxy mechanics (`http-proxy`)
- Add dependency `http-proxy` (low-level, well-maintained; powers most Node proxies). Create the proxy once with the upstream target; mount the catch-all **after** bullet-server's own routes.
- **Compression:** strip `Accept-Encoding` on each forwarded request so the upstream returns bodies uncompressed. This makes `injectHtml`'s string replacement reliable on HTML; non-HTML is piped through untouched. Trade-off: viewers receive uncompressed assets over the tunnel (acceptable for v1; upstream is localhost so the only cost is viewer bandwidth). Noted as a future optimization (strip only for HTML).
- **Redirects / cookies:** enable `autoRewrite` and strip the cookie `Domain` so `Location` headers and `Set-Cookie` from the upstream are rewritten from the upstream origin to the bullet-server origin. Hermes session cookies therefore attach to the bullet-server origin and are shared across viewers — which supports the "same session view" goal.
- **WebSocket (terminal):** enable `ws: true` on the proxy and forward `'upgrade'` events from the HTTP server, so the xterm terminal WS tunnels transparently. (The main chat/agent experience is HTTP-only; this only covers the terminal.)
- **Host header:** forward as needed so the upstream sees a well-formed `Host`.

### 4. Per-request fetch + injection; cookie-based role
- In URL mode, the upstream HTML is fetched **per request** (no caching). Hermes is dynamic (`?v=` cache-busting, session state), so every page load fetches fresh upstream HTML and runs the existing `injectHtml()` ([lib/html-injector.js](../../../lib/html-injector.js)).
- **Role becomes cookie-based, not route-based.** The current model binds role to the route path ([server.js:295-328](../../../server.js#L295-L328)), but a speaker navigating *inside* Hermes (e.g. into `/session/<id>`) changes path, which would break route-based role. New model:
  - `/speaker?token=…` validates the token and sets the existing `bs_speaker_token` cookie (already produced by [lib/speaker-auth.js](../../../lib/speaker-auth.js) `buildSpeakerCookie`).
  - `/moderator` sets a new `bs_moderator` cookie.
  - At injection time, resolve role from cookies in priority: valid `bs_speaker_token` → `speaker`; `bs_moderator` → `moderator`; otherwise `audience`.
  - This makes role persist across Hermes navigation. The Socket.IO side ([server.js:102-110](../../../server.js#L102-L110)) already authorizes the speaker via the token cookie; this extends the same pattern to the injected `BS_ROLE`.
- The `<base href>` tag is **left untouched** — it is `location.origin`-based and will point at the bullet-server, so relative `static/…` refs proxy correctly.

### 5. Minimal injection + service-worker shim (URL mode only)
- In URL mode, inject **only**: `danmaku.css`, the Socket.IO client (`/socket.io/socket.io.js`), `danmaku-renderer.js`, the **role-appropriate panel** (`audience-panel.js` for audience, `moderator-panel.js` for moderator), the role/share config block, and the SW shim below. **Exclude** `slide-sync.js` and `anim-sync/*` — a generic web app is not a slide deck, and the slide-sync keydown handlers (← → space) and anim-sync DOM-API hooks could interfere with Hermes. (File-mode injection is unchanged and still includes the full set.)
- The danmaku UI panels (audience send sidebar / moderator review sidebar) are the *point* of the overlay, so they stay; only slide/animation synchronization is dropped.
- **Verify during implementation** that `audience-panel.js` / `moderator-panel.js` do not depend on globals from `slide-sync.js` or `anim-sync/*`; if they do, inject a minimal stub rather than the full module.
- **Service-worker shim:** inject at the very top of `<head>` (before Hermes's inline scripts) a small script that no-ops the registration:
  ```html
  <script>window.fetch&&(()=>{if(navigator.serviceWorker){navigator.serviceWorker.register=()=>Promise.reject(new Error('disabled'));}})();</script>
  ```
  This prevents Hermes's SW from registering on the bullet-server origin and caching non-injected HTML.

### 6. Sharing / tunnel / security
- The Cloudflare Tunnel already targets the bullet-server (port 3000), so in URL mode **public sharing works transparently** — `:8787` is never exposed directly; only the proxy is. The QR/share dialog ([server.js:281-340](../../../server.js#L281-L340)) is unchanged.
- **Public exposure is opt-in for URL mode.** Because the upstream is an interactive agent+terminal with an unauthenticated API, a public tunnel would let anyone with the link drive the agent / open a shell on the speaker's machine. Therefore:
  - URL mode starts **LAN-only** by default (no tunnel attempted even if `cloudflared` is installed).
  - Public tunnel is enabled only with an explicit opt-in: a `--allow-public` CLI flag **or** `BS_ALLOW_PUBLIC=1` env var.
  - When opt-in is active, print a prominent warning in the startup console (e.g. `⚠️  WARNING: public tunnel enabled — upstream is an interactive app; anyone with the link can use it.`).
  - File mode keeps its current auto-tunnel behavior (low risk).
- v1 nuance: the share dialog shows the bullet-server root URL; the speaker shares a specific session by copying its `/session/<id>` URL. Surfacing the current session path in the dialog is a future enhancement, out of scope here.

## Files to Modify
- `server.js`: mode detection; branch file vs URL setup; mount proxy catch-all after own routes; per-request fetch + injection for HTML responses; cookie-based role resolution; SW shim; `--allow-public` / `BS_ALLOW_PUBLIC` gate; startup console output for URL mode.
- `lib/html-injector.js`: add a "minimal" injection variant (or a flag) for URL mode that injects only the danmaku/role/socket layer + SW shim, and reads role from a parameter. File-mode path unchanged.
- `lib/speaker-auth.js`: add a moderator cookie helper (`buildModeratorCookie`) and a combined `resolveRoleFromCookies(cookies)` helper (speaker → moderator → audience).
- `package.json`: add `http-proxy` dependency.
- `tests/url-proxy.test.js` (new): mock upstream fixture + proxy/injection/role assertions.
- `tests/speaker-auth.test.js`: cover `resolveRoleFromCookies`.
- `README.md`: document URL-source mode, the `--allow-public` security gate, and the Hermes/session-sharing usage.

## Testing
- **Mock upstream fixture:** a tiny `http.createServer` in the test that serves a fixture HTML (with the runtime `<base>` script, a relative `static/a.js`, and an `/api/ping` JSON endpoint) + a `static/a.js` asset. Spin up the bullet-server in URL mode pointed at the fixture.
- Assertions:
  - `/api/ping` is proxied and returns the upstream JSON.
  - `static/a.js` is proxied verbatim.
  - HTML responses contain the injected danmaku scripts and the SW shim; the `<base>` tag is preserved.
  - Role resolution: a request with a valid `bs_speaker_token` cookie yields injected `BS_ROLE='speaker'`; `bs_moderator` → `'moderator'`; no cookie → `'audience'`.
  - `Accept-Encoding` is stripped on forwarded requests (fixture asserts it received `identity` / no `gzip`).
- `resolveRoleFromCookies` is a pure unit test (no server needed).
- Existing tests (`html-injector`, `danmaku-store`, `slide-sync`, `speaker-auth`) remain green and are not affected by the file-mode-preserving changes.

## Risks & Assumptions
- **Shared-session live updates:** whether multiple viewers of a Hermes session see the speaker's actions live depends on Hermes's own multi-client behavior. The transparent proxy preserves whatever Hermes does (if it live-pushes to session clients, viewers see it live; otherwise they see the latest committed state and refresh). **Verify during implementation** by opening the same session in two proxied clients.
- **WebSocket terminal:** WS upgrade proxying must be verified against Hermes's terminal endpoint; if the terminal WS uses a path that collides with bullet-server's own, it needs disambiguation. (No collision expected from the page inspection.)
- **Compression trade-off:** assets are uncompressed to viewers in v1; acceptable, noted for later optimization.
- **Security:** even LAN-only, anyone on the LAN can use the proxied Hermes. The opt-in gate only controls *public* exposure. Documented in README.
- **Redirect/cookie rewriting edge cases:** Hermes-served absolute `Location` headers (if any) must rewrite to the bullet-server origin; `autoRewrite` is expected to handle this but should be verified during implementation.

## Out of Scope
- No screenshare / DOM mirroring of the speaker.
- No new state-sync of the upstream app.
- No change to file-mode behavior.
- No compression passthrough optimization (v1 accepts uncompressed assets over the tunnel).
- No surfacing the current session path in the share dialog.
- No auth/authorization layer added on top of the upstream (we rely on Hermes's own auth model).
