(function() {
  'use strict';

  function AnimationReplayEngine(socket) {
    this.socket = socket;
    this.processedIds = new Set();
    this.handlers = {
      'class-add': handleClassAdd,
      'class-remove': handleClassRemove,
      'class-toggle': handleClassToggle,
      'style-change': handleStyleChange,
      'waapi': handleWaapi,
      'gsap': handleGsap,
      'gsap-timeline': handleGsapTimeline,
      'anime': handleAnime,
      'anime-timeline': handleAnimeTimeline,
      'lottie': handleLottie,
      'declarative': handleDeclarative
    };
    this.socket.on('bs:anim:trigger', this.handleMessage.bind(this));
  }

  AnimationReplayEngine.prototype.handleMessage = function(msg) {
    if (!msg || typeof msg.id === 'undefined' || typeof msg.triggerType === 'undefined') {
      console.warn('[BS-Anim] Invalid message: missing id or triggerType');
      return;
    }

    if (this.processedIds.has(msg.id)) {
      return;
    }
    this.processedIds.add(msg.id);

    var el = document.querySelector(msg.selector);
    if (!el) {
      console.warn('[BS-Anim] Element not found for selector: ' + msg.selector);
      return;
    }

    var handler = this.handlers[msg.triggerType];
    if (!handler) {
      console.warn('[BS-Anim] Unknown triggerType: ' + msg.triggerType);
      return;
    }

    handler(el, msg.payload, msg);
  };

  function handleClassAdd(el, payload) {
    var classNames = payload.classNames || [];
    el.classList.remove.apply(el.classList, classNames);
    void el.offsetWidth;
    el.classList.add.apply(el.classList, classNames);
  }

  function handleClassRemove(el, payload) {
    var classNames = payload.classNames || [];
    el.classList.remove.apply(el.classList, classNames);
  }

  function handleClassToggle(el, payload) {
    el.classList.toggle(payload.className, payload.force);
  }

  function handleStyleChange(el, payload) {
    el.style.setProperty(payload.property, payload.value);
  }

  function handleWaapi(el, payload) {
    el.animate(payload.keyframes, payload.options);
  }

  function handleGsap(el, payload, msg) {
    if (typeof gsap === 'undefined') {
      console.warn('[BS-Anim] GSAP not available for gsap trigger');
      return;
    }

    // Prefer the original selector so multi-element selectors (e.g.
    // '#grid .cell') replay on all matched elements, not just the first one.
    var targets = el;
    if (msg && msg.selector) {
      try {
        if (document.querySelectorAll(msg.selector).length > 0) {
          targets = msg.selector;
        }
      } catch (e) {
        // Invalid selector; fall back to resolved element.
      }
    }

    if (payload.method === 'fromTo' && payload.gsapFromConfig) {
      gsap.fromTo(targets, payload.gsapFromConfig, payload.gsapConfig);
    } else if (payload.method && typeof gsap[payload.method] === 'function') {
      gsap[payload.method](targets, payload.gsapConfig);
    }
  }

  function handleGsapTimeline(el, payload) {
    if (typeof gsap === 'undefined') {
      console.warn('[BS-Anim] GSAP not available for gsap-timeline trigger');
      return;
    }
    if (!payload || !Array.isArray(payload.steps)) {
      console.warn('[BS-Anim] Invalid gsap-timeline payload');
      return;
    }

    var tl = gsap.timeline(payload.timelineParams || {});
    payload.steps.forEach(function(step) {
      var method = step.method;
      var position = step.position;
      if (method === 'fromTo' && step.gsapFromConfig) {
        if (position !== undefined) {
          tl.fromTo(step.selector, step.gsapFromConfig, step.gsapConfig, position);
        } else {
          tl.fromTo(step.selector, step.gsapFromConfig, step.gsapConfig);
        }
      } else if (method && typeof tl[method] === 'function') {
        if (position !== undefined) {
          tl[method](step.selector, step.gsapConfig, position);
        } else {
          tl[method](step.selector, step.gsapConfig);
        }
      }
    });
  }

  function handleAnime(el, payload) {
    if (typeof anime === 'undefined') {
      console.warn('[BS-Anim] anime.js not available for anime trigger');
      return;
    }
    var config = Object.assign({}, payload.animeConfig);
    var originalTargets = config.targets;
    // Preserve string selectors or arrays of selectors from the speaker.
    // Only fall back to the resolved element when the original target was
    // an Element (removed by shallowClone) or otherwise unusable.
    if (!(typeof originalTargets === 'string' && originalTargets.trim()) &&
        !(Array.isArray(originalTargets) && originalTargets.length > 0)) {
      config.targets = el;
    }
    anime(config);
  }

  function handleAnimeTimeline(el, payload) {
    if (typeof anime === 'undefined') {
      console.warn('[BS-Anim] anime.js not available for anime-timeline trigger');
      return;
    }
    if (!payload || !Array.isArray(payload.steps)) {
      console.warn('[BS-Anim] Invalid anime-timeline payload');
      return;
    }

    var tl = anime.timeline(payload.timelineParams || {});
    payload.steps.forEach(function(step) {
      var animParams = Object.assign({}, step.animParams);
      var originalTargets = animParams.targets;
      if (!(typeof originalTargets === 'string' && originalTargets.trim()) &&
          !(Array.isArray(originalTargets) && originalTargets.length > 0)) {
        animParams.targets = el;
      }
      tl.add(animParams, step.offset);
    });
  }

  function handleLottie(el, payload) {
    var anim = null;
    if (typeof window.BS_AnimSync !== 'undefined' && window.BS_AnimSync.lottieAnimations) {
      for (var i = 0; i < window.BS_AnimSync.lottieAnimations.length; i++) {
        var item = window.BS_AnimSync.lottieAnimations[i];
        if (item.container === el) {
          anim = item.animation;
          break;
        }
      }
    }
    if (anim && typeof anim[payload.action] === 'function') {
      anim[payload.action](payload.args);
    } else {
      console.warn('[BS-Anim] Lottie animation not found or action not available');
    }
  }

  function handleDeclarative(el, payload) {
    var animName = payload.animName;
    var handler = null;
    if (typeof window.BS_DECLARATIVE_HANDLERS !== 'undefined') {
      handler = window.BS_DECLARATIVE_HANDLERS[animName];
    }
    if (typeof handler === 'function') {
      handler(el, payload);
    } else {
      var classNames = payload.classNames || [];
      if (payload.action === 'remove') {
        el.classList.remove.apply(el.classList, classNames);
      } else {
        el.classList.remove.apply(el.classList, classNames);
        void el.offsetWidth;
        el.classList.add.apply(el.classList, classNames);
      }
    }
  }

  // Auto-initialization
  if (typeof window !== 'undefined') {
    var poll = setInterval(function() {
      if (window._danmakuSocket) {
        clearInterval(poll);
        var engine = new AnimationReplayEngine(window._danmakuSocket);
        window.BS_AnimSync = window.BS_AnimSync || {};
        window.BS_AnimSync._replayEngine = engine;
      }
    }, 100);
    setTimeout(function() { clearInterval(poll); }, 10000);
  }

  // Node.js compatibility for Jest
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnimationReplayEngine;
  }
})();
