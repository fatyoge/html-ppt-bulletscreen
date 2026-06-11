(function() {
  'use strict';

  /**
   * Trigger Hook Layer
   *
   * Intercepts DOM API calls on the speaker side to detect animation
   * triggers and broadcast them via Socket.IO so audience members can
   * replay the same animations.
   *
   * Only runs when window.BS_ROLE === 'speaker'.
   */

  var elementMap = new WeakMap();

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

  function initHookLayer() {
    if (!window.BS_AnimSync || !window.BS_AnimSync.isSpeaker()) {
      return;
    }

    // ------------------------------------------------------------------
    // 1. Hook classList getter so we can map DOMTokenList -> Element
    // ------------------------------------------------------------------
    var classListDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
    if (classListDescriptor && classListDescriptor.get) {
      var originalGet = classListDescriptor.get;
      Object.defineProperty(Element.prototype, 'classList', {
        get: function() {
          var list = originalGet.call(this);
          elementMap.set(list, this);
          return list;
        },
        configurable: true
      });
    }

    // ------------------------------------------------------------------
    // 2. Hook DOMTokenList.prototype.add
    // ------------------------------------------------------------------
    var originalAdd = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function() {
      originalAdd.apply(this, arguments);

      var el = elementMap.get(this);
      if (!el) {
        return;
      }

      var classNames = [];
      for (var i = 0; i < arguments.length; i++) {
        classNames.push(arguments[i]);
      }

      broadcast({
        triggerType: 'class-add',
        selector: getSelector(el),
        payload: { classNames: classNames }
      });
    };

    // ------------------------------------------------------------------
    // 3. Hook DOMTokenList.prototype.remove
    // ------------------------------------------------------------------
    var originalRemove = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function() {
      originalRemove.apply(this, arguments);

      var el = elementMap.get(this);
      if (!el) {
        return;
      }

      var classNames = [];
      for (var i = 0; i < arguments.length; i++) {
        classNames.push(arguments[i]);
      }

      broadcast({
        triggerType: 'class-remove',
        selector: getSelector(el),
        payload: { classNames: classNames }
      });
    };

    // ------------------------------------------------------------------
    // 4. Hook DOMTokenList.prototype.toggle
    // ------------------------------------------------------------------
    var originalToggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function(className, force) {
      var result = originalToggle.call(this, className, force);

      var el = elementMap.get(this);
      if (!el) {
        return result;
      }

      broadcast({
        triggerType: 'class-toggle',
        selector: getSelector(el),
        payload: {
          className: className,
          force: force
        }
      });

      return result;
    };

    // ------------------------------------------------------------------
    // 5. Hook Element.prototype.setAttribute
    // ------------------------------------------------------------------
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      originalSetAttribute.call(this, name, value);

      if (name === 'style' || name === 'class') {
        broadcast({
          triggerType: 'style-change',
          selector: getSelector(this),
          payload: {
            property: name,
            value: value
          }
        });
      }
    };

    // ------------------------------------------------------------------
    // 6. Hook Element.prototype.animate (WAAPI)
    // ------------------------------------------------------------------
    var originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function(keyframes, options) {
      var animation = originalAnimate.call(this, keyframes, options);

      broadcast({
        triggerType: 'waapi',
        selector: getSelector(this),
        payload: {
          keyframes: keyframes,
          options: options
        }
      });

      return animation;
    };

    console.log('[BS-Anim] Trigger hook layer installed');
  }

  // ------------------------------------------------------------------
  // Wait for window.BS_AnimSync (loaded by common.js)
  // ------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    var poll = setInterval(function() {
      if (window.BS_AnimSync && window.BS_AnimSync.isSpeaker) {
        clearInterval(poll);
        initHookLayer();
      }
    }, 100);

    setTimeout(function() {
      clearInterval(poll);
    }, 10000);
  }
})();
