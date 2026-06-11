(function() {
  'use strict';

  /**
   * Declarative Watcher
   *
   * Monitors elements with data-bs-sync-anim attributes and broadcasts
   * their trigger events. Covers cases that DOM hooks can't catch,
   * like hover effects.
   *
   * Only runs when window.BS_ROLE === 'speaker'.
   */

  function getSelector(el) {
    if (!window.BS_AnimSync || !window.BS_AnimSync.getStableSelector) {
      return '';
    }
    return window.BS_AnimSync.getStableSelector(el);
  }

  function broadcast(data) {
    if (!window.BS_AnimSync || !window.BS_AnimSync.broadcastTrigger) {
      return;
    }
    window.BS_AnimSync.broadcastTrigger(data);
  }

  function watchElement(el) {
    var trigger = el.getAttribute('data-bs-sync-trigger') || 'auto';
    var animName = el.getAttribute('data-bs-sync-anim');
    var rawParams = el.getAttribute('data-bs-sync-params');
    var params = null;

    if (rawParams) {
      try {
        params = JSON.parse(rawParams);
      } catch (e) {
        params = null;
      }
    }

    if (trigger === 'hover') {
      el.addEventListener('mouseenter', function() {
        broadcast({
          triggerType: 'declarative',
          selector: getSelector(el),
          payload: { animName: animName, action: 'start', params: params }
        });
      });
      el.addEventListener('mouseleave', function() {
        broadcast({
          triggerType: 'declarative',
          selector: getSelector(el),
          payload: { animName: animName, action: 'end', params: params }
        });
      });
    } else if (trigger === 'click') {
      el.addEventListener('click', function() {
        broadcast({
          triggerType: 'declarative',
          selector: getSelector(el),
          payload: { animName: animName, action: 'start', params: params }
        });
      });
    } else if (trigger === 'visible') {
      if (typeof IntersectionObserver !== 'undefined') {
        var observer = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) {
              broadcast({
                triggerType: 'declarative',
                selector: getSelector(el),
                payload: { animName: animName, action: 'start', params: params }
              });
            }
          });
        }, { threshold: 0.5 });
        observer.observe(el);
      }
    } else {
      // auto (default): mark element so trigger-hook-layer can check this marker
      el._bsSyncAnim = { name: animName, params: params };
    }
  }

  function initDeclarativeWatcher() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) {
      return;
    }

    // Watch existing elements
    document.querySelectorAll('[data-bs-sync-anim]').forEach(watchElement);

    // Watch for dynamically added elements
    if (typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // ELEMENT_NODE
              if (node.hasAttribute && node.hasAttribute('data-bs-sync-anim')) {
                watchElement(node);
              }
              if (node.querySelectorAll) {
                node.querySelectorAll('[data-bs-sync-anim]').forEach(watchElement);
              }
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    console.log('[BS-Anim] Declarative watcher installed');
  }

  // Poll for BS_AnimSync availability
  if (typeof window !== 'undefined') {
    var poll = setInterval(function() {
      if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
        clearInterval(poll);
        initDeclarativeWatcher();
      }
    }, 100);

    setTimeout(function() {
      clearInterval(poll);
    }, 10000);
  }
})();
