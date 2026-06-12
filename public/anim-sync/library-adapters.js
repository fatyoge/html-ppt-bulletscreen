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
          gsapConfig: shallowClone(toVars),
          gsapFromConfig: shallowClone(fromVars)
        }
      });
      return result;
    };

    // Hook gsap.timeline() so chained .to/.from/.fromTo calls are also broadcast.
    var originalTimeline = gsap.timeline;
    if (originalTimeline) {
      gsap.timeline = function(vars) {
        var tl = originalTimeline.apply(this, arguments);
        ['to', 'from', 'fromTo'].forEach(function(method) {
          var originalMethod = tl[method];
          if (!originalMethod) return;
          tl[method] = function(targets, varsOrFrom, toVars) {
            var result = originalMethod.apply(this, arguments);
            var payload = { method: method };
            if (method === 'fromTo') {
              payload.gsapConfig = shallowClone(toVars);
              payload.gsapFromConfig = shallowClone(varsOrFrom);
            } else {
              payload.gsapConfig = shallowClone(varsOrFrom);
            }
            broadcast({
              triggerType: 'gsap',
              selector: resolveGSAPTarget(targets),
              payload: payload
            });
            return result;
          };
        });
        return tl;
      };
    }

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

    // Hook anime.timeline() so the entire chained timeline is captured and
    // broadcast as one message. Individual .add() steps lose their relative
    // offsets when replayed as separate anime() calls, so we must preserve
    // the whole timeline structure.
    var originalTimeline = originalAnime.timeline;
    if (originalTimeline) {
      window.anime.timeline = function(params) {
        // Preserve the anime object as `this` so the timeline initializes correctly.
        var realTl = originalTimeline.apply(originalAnime, arguments);
        var steps = [];
        var flushTimer = null;
        var timelineId = 'tl-' + Math.random().toString(36).slice(2, 9);

        function flushTimeline() {
          flushTimer = null;
          if (steps.length === 0) return;
          broadcast({
            triggerType: 'anime-timeline',
            selector: '*',
            payload: {
              timelineId: timelineId,
              timelineParams: shallowClone(params),
              steps: steps.slice()
            }
          });
          steps.length = 0;
        }

        function scheduleFlush() {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(flushTimeline, 80);
        }

        // Hook the timeline's own .add() so chained calls naturally flow through
        // the wrapper while preserving anime.js's original return value for chaining.
        var originalAdd = realTl.add;
        realTl.add = function(animParams, offset) {
          var result = originalAdd.apply(realTl, arguments);
          if (animParams) {
            steps.push({
              animParams: shallowClone(animParams),
              offset: offset
            });
            scheduleFlush();
          }
          return result;
        };

        return realTl;
      };
    }

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
