const http = require('http');
const { generateToken } = require('../lib/speaker-auth');
const { createApp } = require('../lib/server-app');
const { startMockUpstream, stop, request } = require('./helpers/mock-upstream');

function serve(app) {
  const server = http.createServer(app).listen(0);
  return { server, origin: 'http://localhost:' + server.address().port };
}

const sampleHtml = '<!doctype html><html><head><title>F</title></head><body><div class="deck"></div></body></html>';

describe('createApp file mode', () => {
  let app, httpSrv;
  afterEach(() => { if (httpSrv) return stop(httpSrv.server); });

  test('serves injected audience HTML at /', async () => {
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('/public/slide-sync.js'); // file mode = full injection
  });

  test('/speaker without token redirects to /', async () => {
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/');
  });

  test('/speaker?token sets cookie then serves speaker HTML', async () => {
    const token = generateToken();
    app = createApp({ mode: 'file', originalHtml: sampleHtml, speakerToken: token, share: { publicUrl: 'https://pub/' } });
    httpSrv = serve(app);
    const r1 = await request(httpSrv.origin, '/speaker?token=' + token);
    expect(r1.statusCode).toBe(302);
    expect(r1.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_speaker_token=' + token)])
    );
    const r2 = await request(httpSrv.origin, '/speaker', { headers: { Cookie: 'bs_speaker_token=' + token } });
    expect(r2.body).toContain("window.BS_ROLE = 'speaker'");
    expect(r2.body).toContain("window.BS_PUBLIC_URL = 'https://pub/'");
  });
});

describe('createApp url mode', () => {
  let upstream, app, httpSrv;
  beforeEach(async () => { upstream = await startMockUpstream(); });
  afterEach(async () => { if (httpSrv) await stop(httpSrv.server); httpSrv = null; await stop(upstream.server); });

  test('/speaker entry sets cookie (valid token) and redirects', async () => {
    const token = generateToken();
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: token, share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker?token=' + token);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/speaker');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_speaker_token=' + token)])
    );
  });

  test('/speaker entry with cookie serves upstream HTML + minimal speaker injection', async () => {
    const token = generateToken();
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: token, share: { publicUrl: 'https://pub/' } });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/speaker', { headers: { Cookie: 'bs_speaker_token=' + token } });
    expect(res.body).toContain("window.BS_ROLE = 'speaker'");
    expect(res.body).toContain('/public/danmaku-renderer.js');
    expect(res.body).not.toContain('/public/slide-sync.js');
  });

  test('/moderator entry sets moderator cookie and injects moderator role', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/moderator');
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('bs_moderator=1')])
    );
    expect(res.body).toContain("window.BS_ROLE = 'moderator'");
  });

  test('catch-all proxies upstream /static and /api verbatim', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const js = await request(httpSrv.origin, '/static/a.js');
    expect(js.body).toBe('// asset /static/a.js');
    const api = await request(httpSrv.origin, '/api/ping');
    expect(api.body).toBe(JSON.stringify({ ok: true }));
  });

  test('catch-all injects audience role on proxied HTML by default', async () => {
    app = createApp({ mode: 'url', upstreamOrigin: upstream.origin, speakerToken: 't', share: {} });
    httpSrv = serve(app);
    const res = await request(httpSrv.origin, '/session/abc');
    expect(res.body).toContain("window.BS_ROLE = 'audience'");
    expect(res.body).toContain('session'); // upstream body preserved
  });

  test('entry route returns 502 when upstream root is non-2xx', async () => {
    const badUpstream = await startMockUpstream({ rootStatus: 500 });
    try {
      const a = createApp({ mode: 'url', upstreamOrigin: badUpstream.origin, speakerToken: 't', share: {} });
      const s = serve(a);
      try {
        const res = await request(s.origin, '/audience');
        expect(res.statusCode).toBe(502);
      } finally {
        await stop(s.server);
      }
    } finally {
      await stop(badUpstream.server);
    }
  });
});
