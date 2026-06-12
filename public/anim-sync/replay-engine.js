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

    handler(el, msg.payload);
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

  function handleGsap(el, payload) {
    if (typeof gsap === 'undefined') {
      console.warn('[BS-Anim] GSAP not available for gsap trigger');
      return;
    }
    if (payload.method === 'fromTo' && payload.gsapFromConfig) {
      gsap.fromTo(el, payload.gsapFromConfig, payload.gsapConfig);
    } else {
      gsap[payload.method](el, payload.gsapConfig);
    }
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
