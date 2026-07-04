function injectHtml(originalHtml, role, serverUrl, publicUrl = '', lanUrl = '', qrDataUrl = '') {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">\n  <link rel="stylesheet" href="/public/attention.css">`;
  let html = originalHtml.replace('</head>', css + '\n</head>');

  let configScript = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';`;

  if (role === 'speaker') {
    if (publicUrl) {
      configScript += `\n      window.BS_PUBLIC_URL = '${publicUrl}';`;
    }
    if (lanUrl) {
      configScript += `\n      window.BS_LAN_URL = '${lanUrl}';`;
    }
    if (qrDataUrl) {
      configScript += `\n      window.BS_QR_CODE = '${qrDataUrl}';`;
    }
  }

  configScript += `\n    </script>`;

  const animSyncScripts = `
    <script src="/public/anim-sync/common.js"></script>
    <script src="/public/anim-sync/replay-engine.js"></script>
    <script src="/public/anim-sync/trigger-hook-layer.js"></script>
    <script src="/public/anim-sync/library-adapters.js"></script>
    <script src="/public/anim-sync/declarative-watcher.js"></script>
  `;

  const script = configScript + animSyncScripts + `
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/attention.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
