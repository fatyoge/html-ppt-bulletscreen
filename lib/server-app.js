const express = require('express');
const path = require('path');
const { injectHtml } = require('./html-injector');
const {
  parseCookie,
  validateToken,
  buildSpeakerCookie,
  buildModeratorCookie
} = require('./speaker-auth');
const { fetchUpstreamHtml, createUrlProxy } = require('./url-proxy');

// Returns true if a response was already sent (redirect) and the caller must return;
// returns false if the request is authorized as speaker and the caller should proceed to inject.
// Shared by the file-mode and url-mode /speaker routes to avoid duplicating the
// speaker-token validation block.
function handleSpeakerAuth(req, res, speakerToken) {
  const queryToken = req.query.token;
  const cookies = parseCookie(req.headers.cookie);
  const cookieToken = cookies.bs_speaker_token;

  if (validateToken(queryToken, speakerToken)) {
    res.setHeader('Set-Cookie', buildSpeakerCookie(queryToken));
    res.redirect('/speaker');
    return true;
  }
  if (!validateToken(cookieToken, speakerToken)) {
    res.redirect('/');
    return true;
  }
  return false;
}

function createApp(opts) {
  const {
    mode,
    originalHtml,
    upstreamOrigin,
    speakerToken,
    share = { publicUrl: '', lanUrl: '', qrDataUrl: '' }
  } = opts;

  const app = express();
  app.use('/public', express.static(path.join(__dirname, '..', 'public')));

  if (mode === 'url') {
    // --- Entry routes: fetch upstream root + inject role + set cookie ---

    app.get('/speaker', async (req, res) => {
      if (handleSpeakerAuth(req, res, speakerToken)) return;
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'speaker', '', share.publicUrl, share.lanUrl, share.qrDataUrl, { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    app.get('/moderator', async (req, res) => {
      res.setHeader('Set-Cookie', buildModeratorCookie());
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'moderator', '', '', '', '', { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    app.get('/audience', async (req, res) => {
      try {
        const html = await fetchUpstreamHtml(upstreamOrigin);
        res.send(injectHtml(html, 'audience', '', '', '', '', { minimal: true }));
      } catch (_) {
        res.status(502).send('Upstream fetch failed');
      }
    });

    // --- Catch-all reverse proxy (everything not matched above) ---
    const urlProxy = createUrlProxy({ upstreamOrigin, speakerToken, share });
    app.locals.urlProxy = urlProxy.proxy;
    app.use(urlProxy.middleware);
  } else {
    // --- File mode: identical to pre-existing behavior ---

    app.get('/', (req, res) => {
      res.send(injectHtml(originalHtml, 'audience', ''));
    });

    app.get('/speaker', (req, res) => {
      if (handleSpeakerAuth(req, res, speakerToken)) return;
      res.send(injectHtml(originalHtml, 'speaker', '', share.publicUrl, share.lanUrl, share.qrDataUrl));
    });

    app.get('/audience', (req, res) => {
      res.send(injectHtml(originalHtml, 'audience', ''));
    });

    app.get('/moderator', (req, res) => {
      res.send(injectHtml(originalHtml, 'moderator', ''));
    });
  }

  return app;
}

module.exports = { createApp };
