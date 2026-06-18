const http = require('http');
const https = require('https');
const httpProxy = require('http-proxy');
const { injectHtml } = require('./html-injector');
const { resolveRole } = require('./speaker-auth');

function fetchUpstreamHtml(upstreamOrigin) {
  const lib = upstreamOrigin.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(upstreamOrigin + '/', {
      headers: { Accept: 'text/html', 'Accept-Encoding': 'identity' }
    }, (upRes) => {
      if (upRes.statusCode < 200 || upRes.statusCode >= 300) {
        return reject(new Error('upstream returned status ' + upRes.statusCode));
      }
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('upstream timeout')));
  });
}

function stripOrigin(value, upstreamOrigin) {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase().startsWith(upstreamOrigin.toLowerCase())) {
    return value.slice(upstreamOrigin.length) || '/';
  }
  return value;
}

function rewriteRedirectHeaders(headers, upstreamOrigin) {
  const h = { ...headers };
  if (h['location']) {
    h['location'] = stripOrigin(h['location'], upstreamOrigin);
  }
  if (h['set-cookie']) {
    const list = Array.isArray(h['set-cookie']) ? h['set-cookie'] : [h['set-cookie']];
    h['set-cookie'] = list.map((c) => c.replace(/;\s*Domain=[^;]*/gi, ''));
  }
  return h;
}

function rewriteResponseHeaders(headers, upstreamOrigin) {
  const h = rewriteRedirectHeaders(headers, upstreamOrigin);
  delete h['content-length'];
  delete h['content-encoding'];
  delete h['transfer-encoding'];
  return h;
}

function handleProxyRes(proxyRes, req, res, ctx) {
  const contentType = proxyRes.headers['content-type'] || '';

  // Non-HTML: pass through body untouched, but still rewrite Location/set-cookie
  // (e.g. 3xx redirects carry no content-type yet must have Location rewritten).
  if (!contentType.includes('text/html')) {
    // Guard the piped stream: an upstream mid-stream error after headers are
    // written would emit 'error' with no handler and crash the process. The
    // http-proxy 'error' listener only covers connection-setup failures.
    proxyRes.on('error', () => { try { res.destroy(); } catch (_) { /* upstream mid-stream error */ } });
    const headers = rewriteRedirectHeaders(proxyRes.headers, ctx.upstreamOrigin);
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
    return;
  }

  // HTML: buffer, inject, respond with corrected length.
  const chunks = [];
  proxyRes.on('data', (c) => chunks.push(c));
  proxyRes.on('error', () => { try { res.end(); } catch (_) { /* noop */ } });
  proxyRes.on('end', () => {
    let body;
    try {
      body = Buffer.concat(chunks).toString('utf8');
    } catch (_) {
      if (!res.headersSent) res.writeHead(502);
      return res.end('Decode failed');
    }
    const role = resolveRole(req.headers.cookie, ctx.speakerToken);
    const isSpeaker = role === 'speaker';
    const injected = injectHtml(
      body,
      role,
      '',
      isSpeaker ? ctx.share.publicUrl : '',
      isSpeaker ? ctx.share.lanUrl : '',
      isSpeaker ? ctx.share.qrDataUrl : '',
      { minimal: true }
    );
    const buf = Buffer.from(injected, 'utf8');
    const headers = rewriteResponseHeaders(proxyRes.headers, ctx.upstreamOrigin);
    headers['content-length'] = String(buf.length);
    res.writeHead(proxyRes.statusCode, headers);
    res.end(buf);
  });
}

function createUrlProxy({ upstreamOrigin, speakerToken, share }) {
  const proxy = httpProxy.createProxyServer({
    target: upstreamOrigin,
    ws: true,
    selfHandleResponse: true,
    changeOrigin: true,
    autoRewrite: true
  });

  const ctx = { upstreamOrigin, speakerToken, share };

  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('Accept-Encoding', 'identity');
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    handleProxyRes(proxyRes, req, res, ctx);
  });

  proxy.on('error', (err, req, res) => {
    if (res && !res.headersSent) {
      res.writeHead(502);
    }
    if (res && typeof res.end === 'function') {
      res.end('Upstream error');
    }
  });

  const middleware = (req, res, next) => {
    // Socket.IO owns its own path on the http server; never proxy it.
    if (req.url.startsWith('/socket.io/')) {
      return next();
    }
    proxy.web(req, res, {}, (err) => next(err));
  };

  return { proxy, middleware };
}

module.exports = { fetchUpstreamHtml, createUrlProxy };
