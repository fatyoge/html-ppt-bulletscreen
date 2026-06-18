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
    // The proxy destroys the client response on upstream mid-stream error, so
    // the response stream closes (either 'end' or 'error'). We assert the
    // promise resolves rather than rejects and that no unhandled throw occurs.
    const outcome = await new Promise((resolve) => {
      const req = http.get(proxyApp.origin + '/static/broken.js', (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ kind: 'end', statusCode: res.statusCode, body: Buffer.concat(chunks).toString() }));
        res.on('error', (e) => resolve({ kind: 'error', code: e.code }));
      });
      req.on('error', (e) => resolve({ kind: 'req-error', code: e.code }));
    });
    expect(['end', 'error', 'req-error']).toContain(outcome.kind);
    // Headers were received before the upstream died: the response started.
    if (outcome.kind === 'end') expect(outcome.statusCode).toBe(200);
    if (outcome.kind === 'error') expect(outcome.code).toBeDefined();
  });
});
