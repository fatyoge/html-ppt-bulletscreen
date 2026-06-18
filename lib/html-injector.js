const SW_SHIM = `<script>(function(){if(navigator&&navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('disabled by bullet-screen'));};}})();</script>`;

function buildScriptSet(options) {
  const minimal = !!(options && options.minimal);
  const animSyncScripts = `
    <script src="/public/anim-sync/common.js"></script>
    <script src="/public/anim-sync/replay-engine.js"></script>
    <script src="/public/anim-sync/trigger-hook-layer.js"></script>
    <script src="/public/anim-sync/library-adapters.js"></script>
    <script src="/public/anim-sync/declarative-watcher.js"></script>
  `;
  if (minimal) {
    return `
      <script src="/socket.io/socket.io.js"></script>
      <script src="/public/danmaku-renderer.js"></script>
      <script src="/public/audience-panel.js"></script>
      <script src="/public/moderator-panel.js"></script>
    `;
  }
  // Default (file) mode: original order — anim-sync first, then core/panels.
  return animSyncScripts + `
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
    <script src="/public/slide-sync.js"></script>
    <script src="/public/audience-panel.js"></script>
    <script src="/public/moderator-panel.js"></script>
  `;
}

function injectHtml(originalHtml, role, serverUrl, publicUrl = '', lanUrl = '', qrDataUrl = '', options = {}) {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const minimal = !!(options && options.minimal);

  let html = originalHtml;
  if (minimal) {
    // SW shim must be the first executable element inside <head>, before upstream inline scripts.
    html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + SW_SHIM);
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  html = html.replace('</head>', css + '\n</head>');

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

  const script = configScript + buildScriptSet(options);
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
