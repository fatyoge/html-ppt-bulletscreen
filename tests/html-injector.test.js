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

  test('injects attention css and script for all roles', () => {
    const result = injectHtml(sampleHtml, 'audience', 'http://localhost:3000');
    expect(result).toContain('<link rel="stylesheet" href="/public/attention.css">');
    expect(result.indexOf('attention.css')).toBeLessThan(result.indexOf('</head>'));
    expect(result).toContain('/public/attention.js');
    expect(result.indexOf('/public/attention.js')).toBeLessThan(result.indexOf('</body>'));
  });
});
