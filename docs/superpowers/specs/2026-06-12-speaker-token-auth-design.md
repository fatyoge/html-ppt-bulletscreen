# Speaker Token Auth Design

## Problem
Currently anyone who guesses or accidentally opens `/speaker` can announce the `speaker` role and take control of the presentation. We need to restrict speaker access to a single, privileged entry point.

## Goal
- Only users who possess the server-generated speaker token can enter `/speaker` and be recognized as the speaker.
- Direct access to `http://<host>/speaker` without a token or valid session must redirect to the audience view (`/`).
- The token should be generated automatically on server start and printed to the console; the share modal does **not** need to expose it.
- After the first successful validation, the address bar should be clean (no token in URL).

## Design

### Token Generation
- On server startup, generate a cryptographically random token using `crypto.randomBytes(16).toString('hex')`.
- Store the token in memory for the lifetime of the process.
- Print the speaker URL with token to the console, alongside the existing audience/moderator URLs.

### Speaker Entry Flow
1. User opens `http://<host>/speaker?token=<TOKEN>`.
2. Server validates the `token` query parameter against the in-memory token.
3. If valid, server sets a cookie named `bs_speaker_token` with value `<TOKEN>` and flags `HttpOnly; SameSite=Strict; Path=/`, then responds with HTTP 302 to `/speaker`.
4. Browser follows redirect to `/speaker`.
5. Server validates the `bs_speaker_token` cookie.
6. If valid, server injects `BS_ROLE='speaker'` and serves the deck HTML.
7. If invalid or missing at any step, server responds with HTTP 302 to `/` (audience view).

### Cookie Validation
- Validation logic is centralized in `lib/speaker-auth.js`.
- `isValidSpeakerToken(token)` compares the provided value with the in-memory token.

### Socket.IO Speaker Authorization
- When a socket emits `role: 'speaker'`, the server reads `bs_speaker_token` from the socket handshake cookies.
- Only sockets with a valid token are allowed to become the speaker (`SlideSync.setSpeaker`).
- Invalid speaker attempts receive `speaker:status { hasControl: false }` and are ignored for all speaker-only events.

### Token Lifecycle
- The token is valid until the server restarts.
- On restart, a new token is generated and the old cookie becomes invalid, causing any existing speaker tab to redirect to `/` on the next request.

## Files to Modify
- `server.js`: token generation, `/speaker` route validation, cookie setting, socket role validation.
- `lib/speaker-auth.js` (new): token generation and validation helpers.
- `tests/speaker-auth.test.js` (new): unit tests for token helpers.
- `README.md`: update console output description and speaker access instructions.

## Out of Scope
- Share modal will continue to show only the audience link; it will not expose the speaker token URL.
- No persistent token storage or admin UI.
- HTTPS enforcement remains out of scope (this is a local/LAN tool).
