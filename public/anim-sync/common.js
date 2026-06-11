(function() {
  'use strict';

  /**
   * Shared utilities for the animation sync system.
   */

  function isSpeaker() {
    return window.BS_ROLE === 'speaker';
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getStableSelector(element) {
    if (!element || element.nodeType !== 1) {
      return '';
    }

    // Priority 1: id attribute
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    // Priority 2: data-* attribute (except data-anim)
    var dataAttrs = element.attributes;
    for (var i = 0; i < dataAttrs.length; i++) {
      var attr = dataAttrs[i];
      if (attr.name.indexOf('data-') === 0 && attr.name !== 'data-anim') {
        return '[' + attr.name + '="' + attr.value.replace(/"/g, '\\"') + '"]';
      }
    }

    // Priority 3: path selector using tag + classes (excluding anim-*) + :nth-of-type
    return buildPathSelector(element);
  }

  function buildPathSelector(element) {
    var parts = [];
    var current = element;

    while (current && current.nodeType === 1 && current !== document.body) {
      var tag = current.tagName.toLowerCase();
      var classes = [];

      if (current.classList) {
        for (var i = 0; i < current.classList.length; i++) {
          var cls = current.classList[i];
          if (cls.indexOf('anim-') !== 0) {
            classes.push(cls);
          }
        }
      }

      var selector = tag;
      if (classes.length > 0) {
        selector += '.' + classes.map(function(c) { return CSS.escape(c); }).join('.');
      }

      // Add :nth-of-type for disambiguation
      var parent = current.parentElement;
      if (parent) {
        var siblings = parent.children;
        var sameTagIndex = 0;
        var sameTagCount = 0;
        for (var j = 0; j < siblings.length; j++) {
          if (siblings[j].tagName === current.tagName) {
            sameTagCount++;
            if (siblings[j] === current) {
              sameTagIndex = sameTagCount;
            }
          }
        }
        if (sameTagCount > 1) {
          selector += ':nth-of-type(' + sameTagIndex + ')';
        }
      }

      parts.unshift(selector);

      // Stop if we have a unique selector
      if (current.id) {
        parts[0] = '#' + CSS.escape(current.id);
        break;
      }

      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function broadcastTrigger(data) {
    if (!window._danmakuSocket) {
      return;
    }

    var message = {
      type: 'bs:anim:trigger',
      id: generateUUID(),
      timestamp: performance.now(),
      triggerType: data.triggerType,
      selector: data.selector,
      payload: data.payload
    };

    window._danmakuSocket.emit('bs:anim:trigger', message);
  }

  // Expose on global namespace
  window.BS_AnimSync = {
    isSpeaker: isSpeaker,
    getStableSelector: getStableSelector,
    broadcastTrigger: broadcastTrigger,
    generateUUID: generateUUID
  };

  // Node.js compatibility for Jest
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isSpeaker: isSpeaker,
      getStableSelector: getStableSelector,
      broadcastTrigger: broadcastTrigger,
      generateUUID: generateUUID
    };
  }
})();
