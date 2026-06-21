(function() {
  'use strict';

  const TRACK_COUNT = 8;
  const TRACK_HEIGHT_PCT = 100 / TRACK_COUNT;

  let socket = null;
  let danmakuLayer = null;
  let tracks = [];
  let isPaused = false;
  let speedMultiplier = 1.0;
  let maxConcurrent = 5;
  let activeDanmaku = [];
  let pendingDanmaku = [];

  function init() {
    createLayer();
    initTracks();
    connectSocket();
    initRoleUI();
  }

  function createLayer() {
    danmakuLayer = document.createElement('div');
    danmakuLayer.id = 'danmaku-layer';
    document.body.appendChild(danmakuLayer);
  }

  function initTracks() {
    tracks = Array(TRACK_COUNT).fill(null).map(() => ({
      busyUntil: 0
    }));
  }

  function connectSocket() {
    const serverUrl = window.BS_SERVER || '';
    socket = io(serverUrl);
    window._danmakuSocket = socket; // Expose for slide-sync.js and panels

    socket.on('connect', () => {
      socket.emit('role', window.BS_ROLE);
    });

    socket.on('danmaku:approved', (dm) => {
      pendingDanmaku.push(dm);
      tryRender();
    });

    socket.on('danmaku:blocked', ({ id }) => {
      removeDanmaku(id);
    });

    socket.on('control:clear', () => {
      clearAll();
    });

    socket.on('control:pause', ({ paused }) => {
      setPaused(paused);
    });

    socket.on('control:speed', ({ speed }) => {
      speedMultiplier = speed;
    });

    socket.on('control:density', ({ density }) => {
      maxConcurrent = density;
    });

    socket.on('control:state', (state) => {
      isPaused = state.paused;
      speedMultiplier = state.speed;
      maxConcurrent = state.density;
    });

    // Save slide sync data for slide-sync.js (which may miss the initial event)
    socket.on('slide:sync', ({ idx }) => {
      window._lastSlideSync = idx;
    });
  }

  function tryRender() {
    if (isPaused) return;
    if (activeDanmaku.length >= maxConcurrent) return;
    if (pendingDanmaku.length === 0) return;

    const dm = pendingDanmaku.shift();
    const trackIdx = findAvailableTrack();
    if (trackIdx === -1) {
      pendingDanmaku.unshift(dm);
      return;
    }

    renderDanmaku(dm, trackIdx);

    if (pendingDanmaku.length > 0 && activeDanmaku.length < maxConcurrent) {
      requestAnimationFrame(tryRender);
    }
  }

  function findAvailableTrack() {
    const now = performance.now();
    for (let i = 0; i < TRACK_COUNT; i++) {
      if (now >= tracks[i].busyUntil) {
        return i;
      }
    }
    return -1;
  }

  function renderDanmaku(dm, trackIdx) {
    const el = document.createElement('div');
    el.className = 'danmaku';
    el.dataset.id = dm.id;
    el.style.color = dm.color;

    const bg = document.createElement('div');
    bg.className = 'dm-bg';
    el.appendChild(bg);

    const text = document.createElement('span');
    text.textContent = dm.text;
    el.appendChild(text);

    const trackTop = trackIdx * TRACK_HEIGHT_PCT;
    el.style.top = trackTop + '%';
    el.style.left = '100%';

    danmakuLayer.appendChild(el);
    activeDanmaku.push({ id: dm.id, el: el, track: trackIdx });

    const width = el.offsetWidth;
    const screenWidth = window.innerWidth;
    const distance = screenWidth + width + 100;
    const baseDuration = 8000;
    const duration = baseDuration / speedMultiplier;

    const clearRatio = 0.5;
    const clearTime = performance.now() + (duration * clearRatio);
    tracks[trackIdx].busyUntil = clearTime;

    el.style.transition = `transform ${duration}ms linear`;

    requestAnimationFrame(() => {
      el.style.transform = `translateX(-${distance}px)`;
    });

    setTimeout(() => {
      removeDanmaku(dm.id);
    }, duration + 100);
  }

  function removeDanmaku(id) {
    const idx = activeDanmaku.findIndex(d => d.id === id);
    if (idx !== -1) {
      const dm = activeDanmaku[idx];
      if (dm.el && dm.el.parentNode) {
        dm.el.parentNode.removeChild(dm.el);
      }
      activeDanmaku.splice(idx, 1);
    }
    const pendingIdx = pendingDanmaku.findIndex(d => d.id === id);
    if (pendingIdx !== -1) {
      pendingDanmaku.splice(pendingIdx, 1);
    }
  }

  function clearAll() {
    activeDanmaku.forEach(dm => {
      if (dm.el && dm.el.parentNode) {
        dm.el.parentNode.removeChild(dm.el);
      }
    });
    activeDanmaku = [];
    pendingDanmaku = [];
    initTracks();
  }

  function setPaused(paused) {
    isPaused = paused;
    if (paused) {
      // Freeze all active danmaku by computing current transform and setting it
      activeDanmaku.forEach(dm => {
        const computed = getComputedStyle(dm.el);
        const matrix = new DOMMatrix(computed.transform);
        dm.el.style.transition = 'none';
        dm.el.style.transform = `translateX(${matrix.m41}px)`;
        dm._paused = true;
      });
    } else {
      // Resume animation from current position
      const screenWidth = window.innerWidth;
      activeDanmaku.forEach(dm => {
        if (dm._paused) {
          const width = dm.el.offsetWidth;
          const distance = screenWidth + width + 100;
          const baseDuration = 8000;
          const duration = baseDuration / speedMultiplier;
          dm.el.style.transition = `transform ${duration}ms linear`;
          dm.el.style.transform = `translateX(-${distance}px)`;
          dm._paused = false;
        }
      });
      tryRender();
    }
  }

  function initRoleUI() {
    const role = window.BS_ROLE;
    if (role === 'speaker') {
      initSpeakerControls();
    } else if (role === 'audience') {
      initAudiencePanel();
    } else if (role === 'moderator') {
      initModeratorPanel();
    }
  }

  function initSpeakerControls() {
    const controls = document.createElement('div');
    controls.id = 'speaker-controls';
    controls.innerHTML = `
      <button id="btn-clear">清空</button>
      <button id="btn-pause">暂停</button>
      <div class="control-group">
        <label>速度</label>
        <input type="range" id="speed-slider" min="0.5" max="3" step="0.1" value="1">
        <span id="speed-val">1.0x</span>
      </div>
      <div class="control-group">
        <label>密度</label>
        <input type="range" id="density-slider" min="1" max="10" step="1" value="5">
        <span id="density-val">5</span>
      </div>
      <div class="control-group">
        <label>高度</label>
        <input type="range" id="top-ratio-slider" min="10" max="100" step="10" value="30">
        <span id="top-ratio-val">30%</span>
      </div>
    `;
    document.body.appendChild(controls);

    // Bottom hover trigger zone
    const trigger = document.createElement('div');
    trigger.id = 'speaker-controls-trigger';
    document.body.appendChild(trigger);

    // Hover interaction: show after dwelling on trigger, hide after leaving controls
    let showTimer = null;
    let hideTimer = null;

    function showControls() {
      clearTimeout(hideTimer);
      controls.classList.add('visible');
    }

    function hideControls() {
      clearTimeout(showTimer);
      hideTimer = setTimeout(() => {
        controls.classList.remove('visible');
      }, 1500);
    }

    trigger.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      showTimer = setTimeout(() => {
        controls.classList.add('visible');
      }, 400);
    });

    trigger.addEventListener('mouseleave', () => {
      clearTimeout(showTimer);
    });

    controls.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      controls.classList.add('visible');
    });

    controls.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => {
        controls.classList.remove('visible');
      }, 1500);
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      socket.emit('control:clear');
    });

    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn.addEventListener('click', () => {
      const newPaused = !isPaused;
      socket.emit('control:pause', { paused: newPaused });
      pauseBtn.textContent = newPaused ? '恢复' : '暂停';
    });

    const speedSlider = document.getElementById('speed-slider');
    speedSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('speed-val').textContent = val.toFixed(1) + 'x';
      socket.emit('control:speed', { speed: val });
    });

    const densitySlider = document.getElementById('density-slider');
    densitySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('density-val').textContent = val;
      socket.emit('control:density', { density: val });
    });

    const topRatioSlider = document.getElementById('top-ratio-slider');
    topRatioSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('top-ratio-val').textContent = val + '%';
      socket.emit('control:topRatio', { topRatio: val / 100 });
    });

    // Share modal
    setupShareModal();
  }

  function setupShareModal() {
    const publicUrl = window.BS_PUBLIC_URL || '';
    const lanUrl = window.BS_LAN_URL || '';
    const qrCode = window.BS_QR_CODE || '';

    if (!publicUrl && !lanUrl) return;

    // Create modal DOM
    const modal = document.createElement('div');
    modal.id = 'share-modal';

    let bodyHtml = '';

    if (qrCode) {
      bodyHtml += `
        <div class="share-qr">
          <p>手机观众请扫码</p>
          <img src="${qrCode}" alt="QR Code">
        </div>
      `;
    }

    if (publicUrl) {
      bodyHtml += `
        <div class="share-link">
          <label>外网链接</label>
          <div class="share-input-row">
            <input type="text" value="${publicUrl}" readonly id="share-input-public">
            <button class="btn-copy" data-target="share-input-public">复制链接</button>
          </div>
        </div>
      `;
    }

    if (lanUrl) {
      bodyHtml += `
        <div class="share-link">
          <label>局域网链接</label>
          <div class="share-input-row">
            <input type="text" value="${lanUrl}" readonly id="share-input-lan">
            <button class="btn-copy" data-target="share-input-lan">复制链接</button>
          </div>
        </div>
      `;
    }

    modal.innerHTML = `
      <div class="share-overlay"></div>
      <div class="share-content">
        <div class="share-header">
          <h3>分享演示</h3>
          <button class="btn-close">&#10005;</button>
        </div>
        <div class="share-body">
          ${bodyHtml}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #share-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 20000;
        display: none;
        align-items: center;
        justify-content: center;
      }
      #share-modal.active {
        display: flex;
      }
      #share-modal .share-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
      }
      #share-modal .share-content {
        position: relative;
        background: #1a1a2e;
        color: #fff;
        border-radius: 12px;
        width: 420px;
        max-width: 90vw;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        overflow: hidden;
      }
      #share-modal .share-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      #share-modal .share-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      #share-modal .btn-close {
        background: none;
        border: none;
        color: #aaa;
        font-size: 18px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
        transition: color 0.2s;
      }
      #share-modal .btn-close:hover {
        color: #fff;
      }
      #share-modal .share-body {
        padding: 20px;
      }
      #share-modal .share-qr {
        text-align: center;
        margin-bottom: 20px;
      }
      #share-modal .share-qr p {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: #ccc;
      }
      #share-modal .share-qr img {
        width: 180px;
        height: 180px;
        border-radius: 8px;
      }
      #share-modal .share-link {
        margin-bottom: 16px;
      }
      #share-modal .share-link:last-child {
        margin-bottom: 0;
      }
      #share-modal .share-link label {
        display: block;
        font-size: 12px;
        color: #aaa;
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      #share-modal .share-input-row {
        display: flex;
        gap: 8px;
      }
      #share-modal .share-input-row input {
        flex: 1;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #fff;
        padding: 8px 12px;
        font-size: 13px;
        outline: none;
      }
      #share-modal .share-input-row input:focus {
        border-color: rgba(255,255,255,0.3);
      }
      #share-modal .btn-copy {
        background: #3b3b5c;
        border: none;
        color: #fff;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.2s;
      }
      #share-modal .btn-copy:hover {
        background: #4a4a6e;
      }
      #share-modal .btn-copy.copied {
        background: #3fb950;
      }
      #share-modal .btn-copy.failed {
        background: #e74c3c;
      }
    `;
    document.head.appendChild(style);

    // Open / close
    function openModal() {
      modal.classList.add('active');
    }
    function closeModal() {
      modal.classList.remove('active');
    }

    modal.querySelector('.btn-close').addEventListener('click', closeModal);
    modal.querySelector('.share-overlay').addEventListener('click', closeModal);

    // Copy buttons
    modal.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        const text = input ? input.value : '';
        let success = false;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(text);
            success = true;
          } catch (err) {
            success = false;
          }
        }

        if (!success) {
          const tmp = document.createElement('input');
          tmp.value = text;
          document.body.appendChild(tmp);
          tmp.select();
          try {
            success = document.execCommand('copy');
          } catch (e) {
            success = false;
          }
          document.body.removeChild(tmp);
        }

        const originalText = btn.textContent;
        if (success) {
          btn.textContent = '已复制';
          btn.classList.add('copied');
        } else {
          btn.textContent = '复制失败';
          btn.classList.add('failed');
        }
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copied', 'failed');
        }, 2000);
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.altKey && e.key === 's') {
        e.preventDefault();
        openModal();
      }
      if (e.key === 'Escape' && modal.classList.contains('active')) {
        closeModal();
      }
    });
  }

  function initAudiencePanel() {
    if (window.initAudiencePanel) {
      window.initAudiencePanel(socket);
    }
  }

  function initModeratorPanel() {
    if (window.initModeratorPanel) {
      window.initModeratorPanel(socket);
    }
  }

  window.DanmakuRenderer = {
    removeDanmaku,
    clearAll
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
