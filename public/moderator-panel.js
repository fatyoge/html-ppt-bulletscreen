(function() {
  'use strict';

  window.initModeratorPanel = function(socket) {
    createPanel(socket);
  };

  function createPanel(socket) {
    const panel = document.createElement('div');
    panel.id = 'side-panel';
    panel.innerHTML = `
      <div class="panel-toggle" title="收起/展开">▶</div>
      <div class="panel-header">
        弹幕审核
        <span class="mode-label auto" id="mode-label">自动通过</span>
      </div>
      <div class="panel-body">
        <div id="moderator-queue"></div>
      </div>
    `;
    document.body.appendChild(panel);

    const queueEl = document.getElementById('moderator-queue');
    const modeLabel = document.getElementById('mode-label');
    const pendingMap = new Map();

    const toggle = panel.querySelector('.panel-toggle');
    let collapsed = false;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      toggle.textContent = collapsed ? '◀' : '▶';
    });

    socket.on('danmaku:pending', (dm) => {
      addPendingCard(dm);
      updateModeLabel(true);
    });

    socket.on('danmaku:removed', ({ id }) => {
      removeCard(id);
    });

    socket.on('moderation:status', ({ active }) => {
      updateModeLabel(active);
    });

    socket.on('moderation:pending', (list) => {
      queueEl.innerHTML = '';
      pendingMap.clear();
      list.forEach(dm => addPendingCard(dm));
      updateModeLabel(list.length > 0);
    });

    function addPendingCard(dm) {
      if (pendingMap.has(dm.id)) return;

      const card = document.createElement('div');
      card.className = 'dm-card';
      card.dataset.id = dm.id;
      card.innerHTML = `
        <div class="dm-text" style="color: ${dm.color}">${escapeHtml(dm.text)}</div>
        <div class="dm-actions">
          <button class="btn-approve">通过</button>
          <button class="btn-block">拦截</button>
        </div>
      `;

      card.querySelector('.btn-approve').addEventListener('click', () => {
        socket.emit('danmaku:approve', { id: dm.id });
      });

      card.querySelector('.btn-block').addEventListener('click', () => {
        socket.emit('danmaku:block', { id: dm.id });
      });

      queueEl.appendChild(card);
      pendingMap.set(dm.id, card);
    }

    function removeCard(id) {
      const card = pendingMap.get(id);
      if (card) {
        card.remove();
        pendingMap.delete(id);
      }
      if (pendingMap.size === 0) {
        updateModeLabel(false);
      }
    }

    function updateModeLabel(active) {
      if (active) {
        modeLabel.textContent = `审核中 (${pendingMap.size})`;
        modeLabel.className = 'mode-label review';
      } else {
        modeLabel.textContent = '自动通过';
        modeLabel.className = 'mode-label auto';
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }
})();
