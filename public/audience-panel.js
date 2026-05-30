(function() {
  'use strict';

  const COLORS = [
    { name: '白', value: '#ffffff' },
    { name: '红', value: '#ff4444' },
    { name: '黄', value: '#ffcc00' },
    { name: '绿', value: '#44ff44' },
    { name: '青', value: '#00ffff' },
    { name: '蓝', value: '#4488ff' },
    { name: '粉', value: '#ff88cc' },
    { name: '橙', value: '#ff8844' }
  ];

  window.initAudiencePanel = function(socket) {
    if (window.innerWidth < 768) {
      createMobilePanel(socket);
    } else {
      createDesktopPanel(socket);
    }
  };

  /* ================================================================
     Desktop Panel
     ================================================================ */
  function createDesktopPanel(socket) {
    const panel = document.createElement('div');
    panel.id = 'side-panel';
    panel.innerHTML = `
      <div class="panel-toggle" title="收起/展开">&#9654;</div>
      <div class="panel-header">发送弹幕</div>
      <div class="panel-body">
        <div id="audience-input"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const inputContainer = document.getElementById('audience-input');
    buildInputArea(inputContainer, socket);

    const toggle = panel.querySelector('.panel-toggle');
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggle.innerHTML = collapsed ? '&#9664;' : '&#9654;';
    });
  }

  /* ================================================================
     Mobile Panel (FAB + Drawer)
     ================================================================ */
  function createMobilePanel(socket) {
    // FAB
    const fab = document.createElement('button');
    fab.id = 'mobile-fab';
    fab.setAttribute('aria-label', '发送弹幕');
    fab.textContent = '+';
    document.body.appendChild(fab);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'drawer-overlay';
    document.body.appendChild(overlay);

    // Drawer
    const drawer = document.createElement('div');
    drawer.id = 'mobile-drawer';
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>发送弹幕</span>
        <button class="drawer-close" aria-label="关闭">&#10005;</button>
      </div>
      <div class="drawer-body">
        <div id="audience-input"></div>
      </div>
    `;
    document.body.appendChild(drawer);

    const inputContainer = document.getElementById('audience-input');
    buildInputArea(inputContainer, socket);

    // Open drawer
    function openDrawer() {
      drawer.classList.add('open');
      overlay.classList.add('visible');
    }

    // Close drawer
    function closeDrawer() {
      drawer.classList.remove('open');
      overlay.classList.remove('visible');
    }

    fab.addEventListener('click', openDrawer);
    overlay.addEventListener('click', closeDrawer);
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
  }

  /* ================================================================
     Shared Input Area
     ================================================================ */
  function buildInputArea(container, socket) {
    container.innerHTML = `
      <textarea id="dm-text" placeholder="输入弹幕内容..." maxlength="100"></textarea>
      <div class="color-picker" id="color-picker"></div>
      <button id="btn-send">发送</button>
      <div class="send-status" id="send-status"></div>
    `;

    // Use setTimeout to ensure DOM is fully ready before binding events
    setTimeout(() => {
      const picker = document.getElementById('color-picker');
      let selectedColor = COLORS[0].value;

      COLORS.forEach(c => {
        const opt = document.createElement('div');
        opt.className = 'color-option' + (c.value === selectedColor ? ' selected' : '');
        opt.style.backgroundColor = c.value;
        opt.title = c.name;
        opt.addEventListener('click', () => {
          selectedColor = c.value;
          picker.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
        });
        picker.appendChild(opt);
      });

      const textInput = document.getElementById('dm-text');
      const sendBtn = document.getElementById('btn-send');
      const statusEl = document.getElementById('send-status');

      function send() {
        const text = textInput.value.trim();
        if (!text) {
          statusEl.textContent = '请输入弹幕内容';
          return;
        }
        socket.emit('danmaku:send', { text, color: selectedColor });
        textInput.value = '';
        statusEl.textContent = '已发送，等待审核...';
      }

      sendBtn.addEventListener('click', send);
      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });

      socket.on('danmaku:rejected', () => {
        statusEl.textContent = '弹幕未通过审核';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      });

      socket.on('danmaku:approved', () => {
        statusEl.textContent = '';
      });
    }, 0);
  }
})();
