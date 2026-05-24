(function() {
  'use strict';

  let socket = null;

  function init() {
    // Wait for socket to be available from danmaku-renderer.js
    const pollSocket = setInterval(() => {
      if (window._danmakuSocket) {
        clearInterval(pollSocket);
        socket = window._danmakuSocket;
        bindSocketEvents();
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(pollSocket);
    }, 10000);
  }

  function bindSocketEvents() {
    if (!socket) return;

    socket.on('slide:go', ({ idx }) => {
      goToSlide(idx, true);
    });

    socket.on('slide:sync', ({ idx }) => {
      goToSlide(idx, true);
    });

    // Only speaker broadcasts slide changes
    if (window.BS_ROLE === 'speaker') {
      setupBroadcastChannelListener();
      setupKeyboardFallback();
    }
  }

  function setupBroadcastChannelListener() {
    const channelName = 'html-ppt-presenter-' + location.pathname;
    let bc = null;
    try {
      bc = new BroadcastChannel(channelName);
    } catch (e) {
      console.log('BroadcastChannel not available, using keyboard fallback');
      return;
    }

    bc.onmessage = function(e) {
      if (!e.data) return;
      if (e.data.type === 'go' && typeof e.data.idx === 'number') {
        socket.emit('slide:go', { idx: e.data.idx });
      }
    };
  }

  function setupKeyboardFallback() {
    document.addEventListener('keydown', function(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const navKeys = ['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Home', 'End'];
      if (!navKeys.includes(e.key)) return;

      const slides = document.querySelectorAll('.slide');
      if (slides.length === 0) return;

      let currentIdx = 0;
      slides.forEach((s, i) => {
        if (s.classList.contains('is-active')) currentIdx = i;
      });

      let newIdx = currentIdx;
      switch(e.key) {
        case 'ArrowRight': case ' ': case 'PageDown':
          newIdx = Math.min(slides.length - 1, currentIdx + 1);
          break;
        case 'ArrowLeft': case 'PageUp':
          newIdx = Math.max(0, currentIdx - 1);
          break;
        case 'Home':
          newIdx = 0;
          break;
        case 'End':
          newIdx = slides.length - 1;
          break;
      }

      if (newIdx !== currentIdx && socket) {
        socket.emit('slide:go', { idx: newIdx });
      }
    });
  }

  function goToSlide(idx, fromRemote) {
    // html-ppt exposes go() globally
    if (typeof window.go === 'function') {
      window.go(idx, fromRemote);
      return;
    }

    // Fallback: manually toggle slide classes
    const slides = document.querySelectorAll('.slide');
    if (idx >= 0 && idx < slides.length) {
      slides.forEach((s, i) => {
        s.classList.toggle('is-active', i === idx);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
