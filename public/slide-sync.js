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

    socket.on('slide:go', ({ idx, transforms }) => {
      goToSlide(idx, true, transforms);
    });

    socket.on('slide:sync', ({ idx, transforms }) => {
      goToSlide(idx, true, transforms);
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

  /* ===== Transform Sync Utilities ===== */

  let lastBroadcastIdx = -1;

  /**
   * Return only real deck slides, ignoring html-ppt overview clones.
   */
  function getSlides() {
    const deck = document.querySelector('.deck');
    if (deck) {
      return deck.querySelectorAll(':scope > .slide');
    }
    return document.querySelectorAll('.slide');
  }

  /**
   * Get a unique index path from root to element.
   * e.g. [0, 2, 1] means root.children[0].children[2].children[1]
   */
  function getElementIndexPath(el, root) {
    const path = [];
    let curr = el;
    while (curr && curr !== root) {
      const parent = curr.parentNode;
      if (!parent) break;
      const index = Array.from(parent.children).indexOf(curr);
      path.unshift(index);
      curr = parent;
    }
    return path;
  }

  /**
   * Find an element by index path under a root element.
   */
  function findElementByIndexPath(root, path) {
    let curr = root;
    for (let i = 0; i < path.length; i++) {
      if (!curr.children || path[i] >= curr.children.length) return null;
      curr = curr.children[path[i]];
    }
    return curr;
  }

  /**
   * Capture transform/opacity state of all elements inside a slide.
   * Only records elements with non-default inline styles or computed transforms.
   */
  function captureSlideTransforms(idx) {
    const slides = getSlides();
    if (idx < 0 || idx >= slides.length) return [];
    const slide = slides[idx];

    const transforms = [];

    function walk(el) {
      const inlineTransform = el.style.transform;
      const inlineOpacity = el.style.opacity;

      // Only sync explicit inline styles set by JS libraries (GSAP/Anime/etc.).
      // Do NOT capture computed values from CSS transitions/animations, otherwise
      // the audience gets stuck mid-transition with inline styles overriding its CSS.
      if (inlineTransform || inlineOpacity) {
        const path = getElementIndexPath(el, slide);
        const record = { path };
        if (inlineTransform) record.transform = inlineTransform;
        if (inlineOpacity) record.opacity = inlineOpacity;
        transforms.push(record);
      }

      Array.from(el.children).forEach(walk);
    }

    walk(slide);
    return transforms;
  }

  /**
   * Apply captured transforms to elements inside a slide.
   */
  function applyTransforms(slideEl, transforms) {
    if (!transforms || !transforms.length) return;
    transforms.forEach((record) => {
      const el = findElementByIndexPath(slideEl, record.path);
      if (!el) return;
      if (record.transform) el.style.transform = record.transform;
      if (record.opacity) el.style.opacity = record.opacity;
    });
  }

  /* ===== Speaker-side broadcast ===== */

  function sendSlideGo(idx) {
    if (idx === lastBroadcastIdx) return;
    lastBroadcastIdx = idx;
    // Delay to let local slide transition/animations settle
    setTimeout(() => {
      const transforms = captureSlideTransforms(idx);
      socket.emit('slide:go', { idx, transforms });
    }, 120);
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
        sendSlideGo(e.data.idx);
      }
    };
  }

  function isHtmlPptRuntimePresent() {
    return !!document.querySelector('script[src*="html-ppt-assets/runtime.js"]');
  }

  function setupKeyboardFallback() {
    // html-ppt runtime handles keyboard navigation itself and broadcasts
    // via BroadcastChannel. Our BroadcastChannel listener forwards those
    // events over Socket.IO. Skip the fallback to avoid double-handling.
    if (isHtmlPptRuntimePresent() && typeof BroadcastChannel === 'function') {
      return;
    }

    document.addEventListener('keydown', function(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const navKeys = ['ArrowRight', 'ArrowLeft', ' ', 'PageDown', 'PageUp', 'Home', 'End'];
      if (!navKeys.includes(e.key)) return;

      const slides = getSlides();
      if (slides.length === 0) return;

      let currentIdx = 0;
      slides.forEach((s, i) => {
        if (s.classList.contains('is-active')) currentIdx = i;
      });

      if (e.defaultPrevented) {
        // The deck's own runtime already moved the slide; just broadcast the new index.
        if (socket) sendSlideGo(currentIdx);
        return;
      }

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
        goToSlide(newIdx, false);
        sendSlideGo(newIdx);
      }
    });
  }

  function goToSlide(idx, fromRemote, transforms) {
    const slides = getSlides();
    const total = slides.length;
    if (idx < 0 || idx >= total) return;

    // html-ppt exposes go() globally; let it drive navigation if available
    if (typeof window.go === 'function') {
      window.go(idx, fromRemote);
    } else {
      // Fallback: replicate html-ppt go() behavior including animations
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

    // 7. Apply speaker-side transform sync (for all templates)
    if (transforms && transforms.length) {
      setTimeout(() => {
        applyTransforms(slides[idx], transforms);
      }, 80);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
