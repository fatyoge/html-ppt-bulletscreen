const express = require('express');
const http = require('http');
const { generateToken } = require('../lib/speaker-auth');
const { createUrlProxy, fetchUpstreamHtml } = require('../lib/url-proxy');
const { startMockUpstream, stop, request } = require('./helpers/mock-upstream');

function startProxyApp({ upstreamOrigin, speakerToken }) {
  const share = { publicUrl: 'https://pub.example/', lanUrl: 'http://lan.example/', qrDataUrl: '' };
  const { middleware } = createUrlProxy({ upstreamOrigin, speakerToken, share });
  const app = express();
  app.use(middleware);
  const server = app.listen(0);
  const origin = 'http://localhost:' + server.address().port;
  return { server, origin };
}

describe('url-proxy', () => {
  let upstream, proxyApp;

  beforeEach(async () => {
    upstream = await startMockUpstream();
  });
  afterEach(async () => {
    if (proxyApp) await stop(proxyApp.server);
    proxyApp = null;
    await stop(upstream.server);
  });

  test('proxies static asset verbatim (not injected)', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/static/a.js');
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe('// asset /static/a.js');
    expect(res.body).not.toContain('danmaku-renderer.js');
  });

  test('proxies JSON API verbatim', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/api/ping');
    expect(res.body).toBe(JSON.stringify({ ok: true }));
  });

  test('injects minimal danmaku layer into HTML (audience by default)', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('/public/danmaku-renderer.js');
    expect(res.body).toContain('navigator.serviceWorker.register');
    expect(res.body).not.toContain('/public/slide-sync.js');
    expect(res.body).not.toContain('/public/anim-sync/');
    expect(parseInt(res.headers['content-length'], 10)).toBe(Buffer.byteLength(res.body, 'utf8'));
  });

  test('resolves speaker role from cookie and injects share vars', async () => {
    const token = generateToken();
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: token });
    const res = await request(proxyApp.origin, '/', { headers: { Cookie: `bs_speaker_token=${token}` } });
    expect(res.body).toContain("window.BS_ROLE = 'speaker'");
    expect(res.body).toContain("window.BS_PUBLIC_URL = 'https://pub.example/'");
  });

  test('resolves moderator role from cookie', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/', { headers: { Cookie: 'bs_moderator=1' } });
    expect(res.body).toContain("window.BS_ROLE = 'moderator'");
  });

  test('forwards Accept-Encoding: identity to upstream', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    await request(proxyApp.origin, '/');
    expect(upstream.getLastHeaders()['accept-encoding']).toBe('identity');
  });

  test('rewrites absolute upstream Location to a relative path', async () => {
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    const res = await request(proxyApp.origin, '/redir');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/session/abc');
  });

  test('fetchUpstreamHtml returns the upstream root HTML', async () => {
    const html = await fetchUpstreamHtml(upstream.origin);
    expect(html).toContain('<div id="x">root</div>');
  });

  test('does not crash when upstream errors mid-stream on a piped asset', async () => {
    // Regression: the non-HTML pass-through branch previously attached no
    // 'error' listener on proxyRes. An upstream TCP reset after headers were
    // written would emit an unhandled 'error' and crash the process.
    proxyApp = startProxyApp({ upstreamOrigin: upstream.origin, speakerToken: 't' });
    // The piped branch must forward the partial body the upstream flushed
    // before dying, then terminate the client stream cleanly (via the
    // proxyRes 'error' listener) instead of hanging or crashing.
    const outcome = await new Promise((resolve) => {
      const chunks = [];
      const req = http.get(proxyApp.origin + '/static/broken.js', (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ kind: 'end', body: Buffer.concat(chunks).toString() }));
        res.on('error', () => resolve({ kind: 'error', body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', () => resolve({ kind: 'req-error', body: Buffer.concat(chunks).toString() }));
    });
    // The client stream must terminate (either 'end' or 'error') rather than
    // hang; a hang still trips Jest's timeout as a backstop, but the body
    // assertion below is the primary load-bearing signal.
    expect(['end', 'error']).toContain(outcome.kind);
    // The upstream flushed headers + `// partial\n` before destroying its
    // socket. Receiving that body proves the piped branch forwarded data and
    // then terminated cleanly, rather than crashing before any bytes flowed.
    expect(outcome.body).toContain('// partial');
  });
});
