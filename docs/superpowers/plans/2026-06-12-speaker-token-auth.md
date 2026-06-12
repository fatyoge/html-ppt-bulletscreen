# Speaker Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict `/speaker` access and the speaker socket role to clients that possess a server-generated token, while keeping the address bar clean after the first validated entry.

**Architecture:** A small `lib/speaker-auth.js` module owns token generation and constant-time validation. `server.js` generates one token at startup, validates the `token` query parameter or `bs_speaker_token` cookie on `/speaker`, and validates the same cookie when a socket declares `role: 'speaker'`. Successful query-token entry sets the cookie and redirects to the clean `/speaker` URL.

**Tech Stack:** Node.js, Express, Socket.IO, built-in `crypto` module (no new dependencies).

---

## File Map

| File | Responsibility |
|---|---|
| `lib/speaker-auth.js` (new) | Generate random token; parse/serialize cookies; constant-time token validation. |
| `tests/speaker-auth.test.js` (new) | Unit tests for token generation, validation, and cookie helpers. |
| `server.js` | Generate token at startup; validate `/speaker` access; validate socket `role: 'speaker'`; print speaker URL with token. |
| `README.md` | Document that speaker URL includes a token and direct `/speaker` redirects to audience. |

---

### Task 1: Create token and cookie helper module

**Files:**
- Create: `lib/speaker-auth.js`
- Test: `tests/speaker-auth.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { generateToken, validateToken, parseCookie, buildSpeakerCookie } = require('../lib/speaker-auth');

describe('speaker-auth', () => {
  test('generateToken returns a 32-char hex string', () => {
    const token = generateToken();
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  test('validateToken accepts matching token', () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  test('validateToken rejects mismatched token', () => {
    const a = generateToken();
    const b = generateToken();
    expect(validateToken(a, b)).toBe(false);
  });

  test('validateToken rejects empty values', () => {
    expect(validateToken('', 'abc')).toBe(false);
    expect(validateToken('abc', '')).toBe(false);
    expect(validateToken(undefined, 'abc')).toBe(false);
  });

  test('parseCookie parses semi-colon separated cookies', () => {
    expect(parseCookie('a=1; bs_speaker_token=xyz; b=2')).toEqual({
      a: '1',
      bs_speaker_token: 'xyz',
      b: '2'
    });
  });

  test('parseCookie returns empty object for missing header', () => {
    expect(parseCookie()).toEqual({});
    expect(parseCookie('')).toEqual({});
  });

  test('buildSpeakerCookie returns expected Set-Cookie string', () => {
    expect(buildSpeakerCookie('abc123')).toBe(
      'bs_speaker_token=abc123; HttpOnly; SameSite=Strict; Path=/'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/speaker-auth.test.js -v`

Expected: FAIL with "Cannot find module '../lib/speaker-auth'".

- [ ] **Step 3: Write minimal implementation**

```javascript
const crypto = require('crypto');

const TOKEN_BYTES = 16;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function validateToken(provided, stored) {
  if (!provided || !stored) return false;
  if (provided.length !== stored.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
  } catch {
    return false;
  }
}

function parseCookie(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[name] = value;
  });
  return cookies;
}

function buildSpeakerCookie(token) {
  return `bs_speaker_token=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

module.exports = {
  generateToken,
  validateToken,
  parseCookie,
  buildSpeakerCookie
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/speaker-auth.test.js -v`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/speaker-auth.js tests/speaker-auth.test.js
git commit -m "feat(speaker-auth): add token generation, validation and cookie helpers"
```

---

### Task 2: Generate token at server startup and print speaker URL

**Files:**
- Modify: `server.js:1-10`
- Modify: `server.js:247-307`

- [ ] **Step 1: Import helpers and generate token**

At the top of `server.js`, add:

```javascript
const { generateToken, validateToken, parseCookie, buildSpeakerCookie } = require('./lib/speaker-auth');
```

After creating the HTTP server, generate the token:

```javascript
const store = new DanmakuStore();
const slideSync = new SlideSync();
const speakerToken = generateToken();
```

- [ ] **Step 2: Print speaker URL with token**

In the `httpServer.listen` callback, replace the speaker console line:

```javascript
console.log(`  演讲者: ${lanUrl}/speaker?token=${speakerToken}`);
```

Also add a note line:

```javascript
console.log(`  提示：演讲者链接已包含 token，请妥善保管`);
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): generate speaker token and print protected speaker URL"
```

---

### Task 3: Protect `/speaker` route with token or cookie

**Files:**
- Modify: `server.js:277-285`

- [ ] **Step 1: Modify the `/speaker` route**

Replace the existing `/speaker` route with:

```javascript
app.get('/speaker', (req, res) => {
  const queryToken = req.query.token;
  const cookies = parseCookie(req.headers.cookie);
  const cookieToken = cookies.bs_speaker_token;

  // First entry: valid token in query sets the cookie and redirects to clean URL.
  if (validateToken(queryToken, speakerToken)) {
    res.setHeader('Set-Cookie', buildSpeakerCookie(queryToken));
    return res.redirect('/speaker');
  }

  // Subsequent visits: require valid cookie.
  if (!validateToken(cookieToken, speakerToken)) {
    return res.redirect('/');
  }

  const html = injectHtml(originalHtml, 'speaker', '', publicUrl, lanUrl, qrDataUrl);
  res.send(html);
});
```

- [ ] **Step 2: Verify route behavior manually**

Start the server:

```bash
node server.js examples/html-ppt-test.html
```

In a browser or with curl:

```bash
# Should redirect to audience
curl -I http://localhost:3000/speaker

# Should set cookie and redirect to /speaker
curl -I "http://localhost:3000/speaker?token=<TOKEN_FROM_CONSOLE>"

# With cookie should return 200
curl -I -H "Cookie: bs_speaker_token=<TOKEN>" http://localhost:3000/speaker
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): protect /speaker route with token or cookie"
```

---

### Task 4: Validate socket `role: 'speaker'` via cookie

**Files:**
- Modify: `server.js:93-119`

- [ ] **Step 1: Update the `role` event handler**

Replace the `socket.on('role', ...)` handler with:

```javascript
socket.on('role', (role) => {
  const cookies = parseCookie(socket.handshake.headers.cookie);
  const cookieToken = cookies.bs_speaker_token;

  // Reject speaker role if the cookie token is missing or invalid.
  if (role === 'speaker' && !validateToken(cookieToken, speakerToken)) {
    socket.data.role = 'audience';
    socket.emit('speaker:status', { hasControl: false });
    return;
  }

  socket.data.role = role;

  if (role === 'speaker') {
    const isFirst = slideSync.setSpeaker(socket.id);
    socket.emit('speaker:status', { hasControl: isFirst });
  }

  if (role === 'moderator') {
    const count = Array.from(io.sockets.sockets.values())
      .filter(s => s.data.role === 'moderator').length;
    store.setModeratorCount(count);
    socket.emit('moderation:status', { active: count > 0 });
    socket.emit('moderation:pending', store.getPending());
  }

  // Send sync state to all new connections
  const currentIdx = slideSync.getCurrentSlide();
  socket.emit('slide:sync', {
    idx: currentIdx,
    total: 0,
    transforms: slideSync.getSlideTransforms(currentIdx)
  });
  socket.emit('control:state', slideSync.getControlState());
});
```

- [ ] **Step 2: Verify socket behavior manually**

Start the server and open an audience tab. In the browser console, attempt:

```javascript
window._danmakuSocket.emit('role', 'speaker');
```

Expected: server ignores it; the page remains an audience (no slide control).

Then open the protected speaker URL. The speaker page should connect and control slides normally.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(server): validate socket speaker role via token cookie"
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md` (speaker URL section)

- [ ] **Step 1: Update speaker access documentation**

Find the section describing speaker access and update it to:

```markdown
### 演讲者入口

启动后控制台会输出类似：

```
演讲者: http://192.168.3.48:3000/speaker?token=abcd1234...
```

请复制这条**带 token** 的链接在演讲者设备上打开。首次访问会自动种下 cookie 并跳转到干净的 `/speaker`。

直接访问 `http://<host>/speaker`（不带 token 或 cookie 已过期）会自动跳转到观众页面。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document protected speaker URL with token"
```

---

### Task 6: Run full test suite and final verification

- [ ] **Step 1: Run unit tests**

```bash
npm test
```

Expected: all 5 test suites pass.

- [ ] **Step 2: Manual end-to-end verification**

```bash
node server.js examples/html-ppt-test.html
```

1. Copy the printed speaker URL (with token) and open it in one browser tab; verify it redirects to `/speaker` and can control slides.
2. Open `http://localhost:3000/` in another tab; verify it follows the speaker.
3. Open `http://localhost:3000/speaker` directly; verify it redirects to `/`.
4. Restart the server; verify the old speaker tab can no longer control until the new token URL is used.

- [ ] **Step 3: Commit if any test/docs changes remain**

```bash
git status
# commit any remaining changes
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Random token generated on startup | Task 2 |
| Speaker URL with token printed to console | Task 2 |
| `/speaker?token=xxx` validates and sets cookie | Task 3 |
| Clean `/speaker` requires valid cookie | Task 3 |
| Missing/invalid token redirects to `/` | Task 3 |
| Socket `role: 'speaker'` validates cookie | Task 4 |
| Share modal does not expose speaker link | out of scope (no change) |
| README updated | Task 5 |

## Placeholder Scan

No TBD/TODO, no vague steps, every code block contains complete code, every command has expected output.

## Type Consistency

- `speakerToken` string is generated once and referenced consistently.
- Cookie name `bs_speaker_token` is consistent across parse, build, and socket validation.
- Helper function names match between `lib/speaker-auth.js` and `tests/speaker-auth.test.js`.
