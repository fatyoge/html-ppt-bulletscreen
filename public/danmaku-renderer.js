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
    `;
    document.body.appendChild(controls);

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
