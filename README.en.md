# Bullet Screen — Real-time Danmaku Server

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Socket.IO-4.8-blue?logo=socket.io" alt="Socket.IO">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
</p>

<p align="center">A local server that adds real-time danmaku (bullet comments) to any HTML presentation — speaker, moderator, and audience in sync.</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a>
</p>

---

## Preview

![Danmaku demo](audience-after-speaker-right.png)

| Desktop audience panel | Mobile drawer |
|:---:|:---:|
| ![Desktop](desktop-panel.png) | ![Mobile](mobile-drawer-open.png) |

Danmaku flies in from the right. The audience types messages and picks a color in the sidebar; when the speaker advances, every client switches in sync, and animations triggered by the speaker replay on the audience side too.

## The Problem It Solves

You give a talk with [html-ppt](https://github.com/lewislulu/html-ppt-skill) or any HTML slides and want the audience to send live danmaku from their phones or laptops — without pulling in a heavy third-party platform.

Bullet Screen runs a local server that injects a complete danmaku system (rendering layer + input panel + moderation) into your HTML file. **Zero build, zero bundling** — pure vanilla JS + CSS.

## Features

**Core**

- **Three roles** — Speaker, Moderator, Audience, each with its own UI and permissions
- **Real-time danmaku** — Instant delivery via WebSocket, DOM-based rendering
- **Slide sync** — The speaker's navigation syncs to all viewers and moderators
- **Moderation** — Multiple moderators collaborate; auto-approve when none are online

**Advanced**

- **Speaker control bar** — Clear, pause/resume, speed and density sliders
- **Animation sync** — CSS / WAAPI / GSAP / Anime.js / Lottie animations replay on the audience side
- **Scroll sync** — When the speaker scrolls or clicks a link on a scroll-snap site, the audience automatically follows to the same position; speaker identity and the danmaku layer persist across pages
- **Attention marker + no-select** — Speaker highlights focus points; accidental text selection never interrupts the talk
- **One-click external sharing** — `Ctrl+Alt+S` opens a QR code + public URL (Cloudflare Tunnel)
- **Mobile-ready** — Phones switch to a floating button + slide-out drawer
- **Multi-file sites** — Works with a single HTML file or a full static site; every `.html` subpage of a multi-page site is auto-injected with the danmaku layer (proxies same-origin assets)

## Quick Start

### 1. Install

```bash
git clone https://github.com/yourusername/bullet-screen.git
cd bullet-screen
npm install
```

### 2. Launch

```bash
# Using the built-in test deck
node server.js examples/html-ppt-test.html

# Or your own html-ppt file / static site entry
node server.js ~/my-talk/index.html
```

After launch, the console prints three URLs:

```
🎯 Danmaku server started

LAN access:
  Speaker:   http://192.168.3.48:3000/speaker?token=abcd1234...
  Moderator: http://192.168.3.48:3000/moderator
  Audience:  http://192.168.3.48:3000/
```

### 3. Get going

1. **Speaker** — Copy the `/speaker` URL **with its `token`** and open it on the presenting device (first visit sets a cookie and redirects to a clean `/speaker`)
2. **Moderator** (optional) — Open `/moderator` to review danmaku
3. **Audience** — Open the root path `/` to send and view danmaku

> [!NOTE]
> When no moderator is online, danmaku is auto-approved. When a moderator is present, danmaku enters a review queue. Visiting `/speaker` without a token (or with an expired cookie) redirects to the audience page.

> [!TIP]
> External sharing relies on Cloudflare Tunnel (`cloudflared`). Without it, only LAN access is available and no public URL is generated.
>
> **Install cloudflared:**
> ```bash
> # Windows
> winget install --id Cloudflare.cloudflared
> # macOS
> brew install cloudflare/cloudflare/cloudflared
> ```
> Other platforms: see the [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).

## The Three Roles

### Speaker

- Full-screen slide display; navigate with `←` `→` `Space`
- Bottom control bar: clear, pause/resume, speed, density, no-select toggle
- `Ctrl+Alt+S` opens the share dialog (public URL + LAN URL + QR code)
- Slides and animations auto-sync to all viewers

### Audience

- Full-screen slide display
- **Desktop**: collapsible right sidebar — text input + 8-color picker
- **Mobile**: floating button at bottom-right; tap to slide out a drawer
- URL: `/` (root, no suffix)

### Moderator

- Full-screen slide display
- Right sidebar: pending danmaku queue; approve or block each item
- Multiple moderators can work at once on a shared queue

## Animation Sync

Animations triggered on the speaker side automatically replay for every audience member — no configuration needed.

![Animation sync](speaker-anime-timeline-final.png)

**Supported animation types:**

| Type | Auto-sync | Notes |
|------|:---:|------|
| CSS `@keyframes` | ✅ | Triggered via `classList.add()` |
| CSS Transition | ✅ | `style` / `class` changes |
| Web Animations API | ✅ | `element.animate()` |
| GSAP | ✅ | `gsap.to()` / `from()` / `timeline()` |
| Anime.js | ✅ | `anime({...})` |
| Lottie | ✅ | `play()` / `pause()` / `stop()` |
| Declarative annotation | ✅ | `data-bs-sync-anim` attribute (below) |
| `:hover` / `:focus` pseudo-classes | ⚠️ annotate | Can't be intercepted; use declarative |

**Declarative annotation** (for cases like `:hover` that can't be intercepted automatically):

```html
<div data-bs-sync-anim="hover-glow" data-bs-sync-trigger="hover">...</div>
<div data-bs-sync-anim="scroll-reveal" data-bs-sync-trigger="visible">...</div>
<div data-bs-sync-anim="fade-in" data-bs-sync-trigger="auto">...</div>
```

**Five built-in test pages** (verify each animation type):

```bash
node server.js examples/anim-test-css.html        # CSS Animation + Transition
node server.js examples/anim-test-waapi.html      # Web Animations API
node server.js examples/anim-test-gsap.html       # GSAP
node server.js examples/anim-test-anime.html      # Anime.js
node server.js examples/anim-test-declarative.html
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Your HTML slides                     │
│   ┌────────────────────────────────────────────────┐  │
│   │     Server-injected danmaku layer (public/)      │  │
│   │  Renderer · Controls · Role Panels · Attention · Anim-Sync │  │
│   └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                            │ WebSocket (Socket.IO)
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Danmaku Store        Slide Sync        Moderator Queue
   (store + review)    (slide state)      (review queue)
```

## Project Structure

```
bullet-screen/
├── server.js                  # Express + Socket.IO entry
├── lib/
│   ├── html-injector.js       # HTML injector
│   ├── danmaku-store.js       # Danmaku storage (queue + moderation)
│   ├── slide-sync.js          # Slide sync state
│   └── speaker-auth.js        # Speaker token auth
├── public/                    # Frontend assets injected into the page
│   ├── danmaku.css            # Danmaku layer + UI styles
│   ├── danmaku-renderer.js    # Danmaku rendering engine
│   ├── slide-sync.js          # Slide sync client
│   ├── audience-panel.js      # Audience sidebar
│   ├── moderator-panel.js     # Moderator sidebar
│   ├── attention.css / .js    # Attention marker + no-select
│   └── anim-sync/             # Animation sync (trigger hooks / lib adapters / replay engine)
├── tests/                     # Jest unit tests
│   ├── anim-sync/             # Animation replay tests
│   └── *.test.js              # store / injector / sync / auth / attention
├── examples/                  # Sample decks and animation test pages
├── docs/superpowers/          # Design docs and implementation plans
└── package.json
```

## Configuration

| Method | Purpose | Example |
|------|------|------|
| CLI argument | Path to HTML file | `node server.js ./talk.html` |
| Environment variable | Port | `PORT=8080 node server.js ./talk.html` |

## Development

```bash
npm test                                  # Run the Jest suite
node server.js examples/html-ppt-test.html   # Start in dev mode
```

Tests cover: HTML injection, danmaku queue & moderation, slide sync, speaker auth, attention marker, and the animation replay engine.

## Protocol

Server and client communicate via Socket.IO. Key events:

| Direction | Event | Sender/Target | Description |
|------|------|-----------|------|
| `→` | `danmaku:send` | audience | Send a danmaku |
| `→` | `danmaku:block` | moderator | Block a danmaku |
| `→` | `slide:go` | speaker | Navigate slides |
| `→` | `nav:go` | speaker | Position sync for scroll/multi-page sites (page path + section index) |
| `→` | `control:*` | speaker | Control command |
| `←` | `danmaku:approved` | all | Danmaku approved |
| `←` | `danmaku:blocked` | all | Danmaku blocked |
| `←` | `slide:go` | audience/moderator | Slide sync |
| `←` | `slide:sync` | new connection | Current slide position |
| `←` | `nav:go` | audience/moderator | Follow speaker scroll or page change |
| `←` | `nav:sync` | new connection | Current page and section (catch-up) |

Full protocol in the [design doc](docs/superpowers/specs/2026-05-24-bullet-screen-design.md).

## Browser Compatibility

- Chrome / Edge ≥ 90
- Firefox ≥ 88
- Safari ≥ 14

> [!NOTE]
> Requires the BroadcastChannel API. Safari below 14 automatically falls back to keyboard event interception.

## Related Projects

- [html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) — Zero-build HTML presentation generator; this project deeply integrates its slide events and animation system.
