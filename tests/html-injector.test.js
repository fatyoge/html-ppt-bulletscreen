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
});
