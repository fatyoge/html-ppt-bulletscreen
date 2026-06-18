const { injectHtml } = require('../lib/html-injector');

describe('injectHtml', () => {
  const sampleHtml = `<!DOCTYPE html>
<html><head><title>Test</title></head>
<body><div class="deck"></div></body></html>`;

  test('injects CSS link before </head>', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('<link rel="stylesheet" href="/public/danmaku.css">');
    expect(result.indexOf('danmaku.css')).toBeLessThan(result.indexOf('</head>'));
  });

  test('injects role and server config before socket.io', () => {
    const result = injectHtml(sampleHtml, 'audience', 'http://localhost:3000');
    expect(result).toContain("window.BS_ROLE = 'audience'");
    expect(result).toContain("window.BS_SERVER = 'http://localhost:3000'");
  });

  test('injects socket.io and danmaku scripts before </body>', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('/socket.io/socket.io.js');
    expect(result).toContain('/public/danmaku-renderer.js');
    expect(result).toContain('/public/slide-sync.js');
    expect(result).toContain('/public/audience-panel.js');
    expect(result).toContain('/public/moderator-panel.js');
    const bodyCloseIdx = result.indexOf('</body>');
    const scriptIdx = result.indexOf('danmaku-renderer.js');
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  test('preserves original HTML structure', () => {
    const result = injectHtml(sampleHtml, 'moderator', 'http://localhost:3000');
    expect(result).toContain('<div class="deck">');
    expect(result).toContain('<title>Test</title>');
  });

  test('throws if HTML lacks </head>', () => {
    expect(() => injectHtml('<html><body></body></html>', 'speaker', ''))
      .toThrow('HTML must contain </head>');
  });

  test('throws if HTML lacks </body>', () => {
    expect(() => injectHtml('<html><head></head></html>', 'speaker', ''))
      .toThrow('HTML must contain </body>');
  });

  test('injects public URL and QR code for speaker role', () => {
    const result = injectHtml(
      sampleHtml,
      'speaker',
      'http://localhost:3000',
      'https://abc123.ngrok.io',
      'http://192.168.1.5:3000',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    expect(result).toContain("window.BS_PUBLIC_URL = 'https://abc123.ngrok.io'");
    expect(result).toContain("window.BS_LAN_URL = 'http://192.168.1.5:3000'");
    expect(result).toContain("window.BS_QR_CODE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='");
  });

  test('does not inject speaker-only vars for audience role', () => {
    const result = injectHtml(
      sampleHtml,
      'audience',
      'http://localhost:3000',
      'https://abc123.ngrok.io',
      'http://192.168.1.5:3000',
      'data:image/png;base64,abc123'
    );
    expect(result).not.toContain('BS_PUBLIC_URL');
    expect(result).not.toContain('BS_LAN_URL');
    expect(result).not.toContain('BS_QR_CODE');
  });

  test('minimal mode injects SW shim at the very top of head', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    const headOpenIdx = result.indexOf('<head>');
    const shimIdx = result.indexOf('navigator.serviceWorker.register');
    expect(shimIdx).toBeGreaterThan(-1);
    expect(shimIdx).toBeGreaterThan(headOpenIdx);
    // shim appears before danmaku.css
    expect(shimIdx).toBeLessThan(result.indexOf('danmaku.css'));
  });

  test('minimal mode includes danmaku core and panels', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    expect(result).toContain('/public/danmaku.css');
    expect(result).toContain('/socket.io/socket.io.js');
    expect(result).toContain('/public/danmaku-renderer.js');
    expect(result).toContain('/public/audience-panel.js');
    expect(result).toContain('/public/moderator-panel.js');
  });

  test('minimal mode excludes slide-sync and anim-sync', () => {
    const result = injectHtml(sampleHtml, 'audience', '', '', '', '', { minimal: true });
    expect(result).not.toContain('/public/slide-sync.js');
    expect(result).not.toContain('/public/anim-sync/');
  });

  test('minimal mode injects role config', () => {
    const result = injectHtml(sampleHtml, 'moderator', '', '', '', '', { minimal: true });
    expect(result).toContain("window.BS_ROLE = 'moderator'");
  });

  test('non-minimal mode still injects slide-sync and anim-sync (unchanged)', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    expect(result).toContain('/public/slide-sync.js');
    expect(result).toContain('/public/anim-sync/common.js');
    expect(result).not.toContain('navigator.serviceWorker.register');
  });

  test('default mode preserves original script order (anim-sync before socket.io before slide-sync before panels)', () => {
    const result = injectHtml(sampleHtml, 'speaker', 'http://localhost:3000');
    const idx = (needle) => result.indexOf(needle);
    expect(idx('/public/anim-sync/common.js')).toBeLessThan(idx('/socket.io/socket.io.js'));
    expect(idx('/socket.io/socket.io.js')).toBeLessThan(idx('/public/danmaku-renderer.js'));
    expect(idx('/public/danmaku-renderer.js')).toBeLessThan(idx('/public/slide-sync.js'));
    expect(idx('/public/slide-sync.js')).toBeLessThan(idx('/public/audience-panel.js'));
    expect(idx('/public/audience-panel.js')).toBeLessThan(idx('/public/moderator-panel.js'));
    expect(idx('/public/anim-sync/declarative-watcher.js')).toBeLessThan(idx('/public/moderator-panel.js'));
  });

  test('minimal mode sw shim runs before an upstream inline head script', () => {
    const htmlWithHeadScript = `<!DOCTYPE html><html><head><title>T</title>
<script>window.__upstream=1;</script></head><body></body></html>`;
    const result = injectHtml(htmlWithHeadScript, 'audience', '', '', '', '', { minimal: true });
    expect(result.indexOf('navigator.serviceWorker.register'))
      .toBeLessThan(result.indexOf('window.__upstream=1'));
  });
});
