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

    // Catch up if we missed the initial slide:sync event
    if (typeof window._lastSlideSync === 'number') {
      goToSlide(window._lastSlideSync, true);
    }

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

    // Fallback: replicate html-ppt go() behavior including animations
    const slides = document.querySelectorAll('.slide');
    const total = slides.length;
    if (idx < 0 || idx >= total) return;

    // 1. Toggle slide visibility classes
    slides.forEach((s, i) => {
      s.classList.toggle('is-active', i === idx);
      s.classList.toggle('is-prev', i < idx);
    });

    // 2. Update progress bar
    const barFill = document.querySelector('.progress-bar span');
    if (barFill) {
      barFill.style.width = ((idx + 1) / total * 100) + '%';
    }

    // 3. Update slide number
    const numEl = document.querySelector('.slide-number');
    if (numEl) {
      numEl.setAttribute('data-current', idx + 1);
      numEl.setAttribute('data-total', total);
    }

    // 4. Update URL hash (1-based)
    const hashTarget = '#/' + (idx + 1);
    if (location.hash !== hashTarget) {
      history.replaceState(null, '', hashTarget);
    }

    // 5. Re-trigger entry animations (critical for visual effect)
    const activeSlide = slides[idx];
    activeSlide.querySelectorAll('[data-anim]').forEach(el => {
      const anim = el.getAttribute('data-anim');
      el.classList.remove('anim-' + anim);
      void el.offsetWidth; // force reflow
      el.classList.add('anim-' + anim);
    });

    // 6. Re-trigger counter-up animations
    activeSlide.querySelectorAll('.counter').forEach(el => {
      const target = parseFloat(el.getAttribute('data-to') || el.textContent);
      const dur = parseInt(el.getAttribute('data-dur') || '1200', 10);
      const start = performance.now();
      function tick(now) {
        const t = Math.min(1, (now - start) / dur);
        const v = target * (1 - Math.pow(1 - t, 3));
        el.textContent = (target % 1 === 0) ? Math.round(v) : v.toFixed(1);
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
