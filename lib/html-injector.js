function injectHtml(originalHtml, role, serverUrl) {
  if (!originalHtml.includes('</head>')) {
    throw new Error('HTML must contain </head>');
  }
  if (!originalHtml.includes('</body>')) {
    throw new Error('HTML must contain </body>');
  }

  const css = `<link rel="stylesheet" href="/public/danmaku.css">`;
  let html = originalHtml.replace('</head>', css + '\n</head>');

  const script = `
    <script>
      window.BS_ROLE = '${role}';
      window.BS_SERVER = '${serverUrl}';
    </script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/public/danmaku-renderer.js"></script>
  `;
  html = html.replace('</body>', script + '\n</body>');

  return html;
}

module.exports = { injectHtml };
