(function() {
  'use strict';

  /**
   * Library Adapters
   *
   * Hooks into GSAP, Anime.js, and Lottie animation libraries to detect
   * animation triggers on the speaker side and broadcast them via Socket.IO
   * so audience members can replay the same animations.
   *
   * Only runs when window.BS_ROLE === 'speaker'.
   *
   * Libraries may load after this script runs (via CDN in user's HTML),
   * so we poll periodically to detect and hook them.
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

  function shallowClone(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    var cloned = Array.isArray(obj) ? [] : {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        var val = obj[key];
        if (typeof val === 'function') {
          continue;
        }
        if (val instanceof Element) {
          continue;
        }
        cloned[key] = val;
      }
    }
    return cloned;
  }

  // ------------------------------------------------------------------
  // GSAP Adapter
  // ------------------------------------------------------------------

  function resolveGSAPTarget(targets) {
    if (typeof targets === 'string') {
      return targets;
    }
    if (targets instanceof Element) {
      return getSelector(targets);
    }
    if (targets && targets.length && targets[0] instanceof Element) {
      return getSelector(targets[0]);
    }
    return '*';
  }

  var gsapInstalled = false;

  function installGSAPAdapter() {
    if (gsapInstalled) {
      return;
    }
    if (typeof gsap === 'undefined') {
      return;
    }

    var originalTo = gsap.to;
    gsap.to = function(targets, vars) {
      var result = originalTo.apply(this, arguments);
      broadcast({
        triggerType: 'gsap',
        selector: resolveGSAPTarget(targets),
        payload: {
          method: 'to',
          gsapConfig: shallowClone(vars)
        }
      });
      return result;
    };

    var originalFrom = gsap.from;
    gsap.from = function(targets, vars) {
      var result = originalFrom.apply(this, arguments);
      broadcast({
        triggerType: 'gsap',
        selector: resolveGSAPTarget(targets),
        payload: {
          method: 'from',
          gsapConfig: shallowClone(vars)
        }
      });
      return result;
    };

    var originalFromTo = gsap.fromTo;
    gsap.fromTo = function(targets, fromVars, toVars) {
      var result = originalFromTo.apply(this, arguments);
      broadcast({
        triggerType: 'gsap',
        selector: resolveGSAPTarget(targets),
        payload: {
          method: 'fromTo',
          gsapConfig: shallowClone(toVars)
        }
      });
      return result;
    };

    gsapInstalled = true;
    console.log('[BS-Anim] GSAP adapter installed');
  }

  // ------------------------------------------------------------------
  // Anime.js Adapter
  // ------------------------------------------------------------------

  function resolveAnimeTarget(targets) {
    if (typeof targets === 'string') {
      return targets;
    }
    if (targets instanceof Element) {
      return getSelector(targets);
    }
    if (targets && targets.length && targets[0] instanceof Element) {
      return getSelector(targets[0]);
    }
    return '*';
  }

  var animeInstalled = false;

  function installAnimeAdapter() {
    if (animeInstalled) {
      return;
    }
    if (typeof anime === 'undefined') {
      return;
    }

    var originalAnime = anime;
    window.anime = function(params) {
      var result = originalAnime.apply(this, arguments);
      broadcast({
        triggerType: 'anime',
        selector: resolveAnimeTarget(params.targets),
        payload: { animeConfig: shallowClone(params) }
      });
      return result;
    };

    Object.keys(originalAnime).forEach(function(key) {
      window.anime[key] = originalAnime[key];
    });

    animeInstalled = true;
    console.log('[BS-Anim] Anime.js adapter installed');
  }

  // ------------------------------------------------------------------
  // Lottie Adapter
  // ------------------------------------------------------------------

  var lottieInstalled = false;

  function installLottieAdapter() {
    if (lottieInstalled) {
      return;
    }
    if (typeof lottie === 'undefined' || !lottie.loadAnimation) {
      return;
    }

    var originalLoadAnimation = lottie.loadAnimation;
    lottie.loadAnimation = function(params) {
      var anim = originalLoadAnimation.apply(this, arguments);

      var actions = ['play', 'pause', 'stop'];
      actions.forEach(function(action) {
        if (!anim[action]) {
          return;
        }
        var originalAction = anim[action];
        anim[action] = function() {
          var container = typeof params.container === 'string'
            ? document.querySelector(params.container)
            : params.container;
          broadcast({
            triggerType: 'lottie',
            selector: container ? getSelector(container) : '*',
            payload: {
              lottieAction: action,
              lottieConfig: {
                renderer: params.renderer,
                loop: params.loop,
                autoplay: params.autoplay
              }
            }
          });
          return originalAction.apply(this, arguments);
        };
      });

      return anim;
    };

    lottieInstalled = true;
    console.log('[BS-Anim] Lottie adapter installed');
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  function initLibraryAdapters() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) {
      return;
    }

    installGSAPAdapter();
    installAnimeAdapter();
    installLottieAdapter();
  }

  // ------------------------------------------------------------------
  // Wait for window.BS_AnimSync (loaded by common.js)
  // ------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    var poll = setInterval(function() {
      if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
        clearInterval(poll);
        initLibraryAdapters();
      }
    }, 100);

    setTimeout(function() {
      clearInterval(poll);
    }, 10000);

    // Re-check periodically because libraries may load later (via CDN)
    var recheckAttempts = 0;
    var recheckInterval = setInterval(function() {
      recheckAttempts++;
      if (recheckAttempts > 20) {
        clearInterval(recheckInterval);
        return;
      }
      initLibraryAdapters();
    }, 500);
  }
})();
