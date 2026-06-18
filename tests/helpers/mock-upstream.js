const http = require('http');

const ROOT_HTML = `<!doctype html><html><head><title>Up</title></head><body><div id="x">root</div></body></html>`;
const SESSION_HTML = `<!doctype html><html><head><title>Up</title></head><body><div id="x">session</div></body></html>`;

function startMockUpstream() {
  let lastHeaders = {};
  const server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(ROOT_HTML);
    }
    if (req.url === '/session/abc') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(SESSION_HTML);
    }
    if (req.url === '/redir') {
      const port = server.address().port;
      res.setHeader('location', `http://localhost:${port}/session/abc`);
      res.writeHead(302);
      return res.end();
    }
    if (req.url.startsWith('/static/')) {
      res.setHeader('content-type', 'application/javascript');
      return res.end('// asset ' + req.url);
    }
    if (req.url === '/api/ping') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const origin = 'http://localhost:' + server.address().port;
      resolve({ server, origin, getLastHeaders: () => lastHeaders });
    });
  });
}

function stop(server) {
  return new Promise((r) => server.close(() => r()));
}

function request(origin, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin + path, { headers: opts.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
  });
}

module.exports = { startMockUpstream, stop, request };
