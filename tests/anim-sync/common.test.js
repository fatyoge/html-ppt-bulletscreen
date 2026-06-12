/**
 * @jest-environment jsdom
 */

// Polyfill CSS.escape for jsdom (not available by default)
if (typeof CSS === 'undefined' || !CSS.escape) {
  global.CSS = global.CSS || {};
  global.CSS.escape = function(str) {
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

const { isSpeaker, getStableSelector, generateUUID, broadcastTrigger } = require('../../public/anim-sync/common');

describe('isSpeaker', () => {
  afterEach(() => {
    delete window.BS_ROLE;
  });

  test('returns true when window.BS_ROLE is speaker', () => {
    window.BS_ROLE = 'speaker';
    expect(isSpeaker()).toBe(true);
  });

  test('returns false when window.BS_ROLE is audience', () => {
    window.BS_ROLE = 'audience';
    expect(isSpeaker()).toBe(false);
  });

  test('returns false when window.BS_ROLE is moderator', () => {
    window.BS_ROLE = 'moderator';
    expect(isSpeaker()).toBe(false);
  });

  test('returns false when window.BS_ROLE is missing', () => {
    delete window.BS_ROLE;
    expect(isSpeaker()).toBe(false);
  });
});

describe('generateUUID', () => {
  test('returns a string', () => {
    const uuid = generateUUID();
    expect(typeof uuid).toBe('string');
  });

  test('returns a valid UUID v4 format', () => {
    const uuid = generateUUID();
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidV4Pattern);
  });

  test('returns unique values on multiple calls', () => {
    const uuid1 = generateUUID();
    const uuid2 = generateUUID();
    const uuid3 = generateUUID();
    expect(uuid1).not.toBe(uuid2);
    expect(uuid2).not.toBe(uuid3);
    expect(uuid1).not.toBe(uuid3);
  });
});

describe('getStableSelector', () => {
  test('returns empty string for null element', () => {
    expect(getStableSelector(null)).toBe('');
  });

  test('returns empty string for non-element input', () => {
    expect(getStableSelector('not an element')).toBe('');
  });

  test('uses id when element has id', () => {
    const el = document.createElement('div');
    el.id = 'my-element';
    expect(getStableSelector(el)).toBe('#my-element');
  });

  test('escapes id with special characters', () => {
    const el = document.createElement('div');
    el.id = 'my:element';
    expect(getStableSelector(el)).toBe('#my\\:element');
  });

  test('uses data attribute when no id', () => {
    const el = document.createElement('div');
    el.setAttribute('data-slide', '3');
    expect(getStableSelector(el)).toBe('[data-slide="3"]');
  });

  test('prefers first data attribute (alphabetically) when no id', () => {
    const el = document.createElement('div');
    el.setAttribute('data-anim', 'fade');
    el.setAttribute('data-step', '2');
    expect(getStableSelector(el)).toBe('[data-step="2"]');
  });

  test('falls back to unique path when data attribute is shared by multiple elements', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('div');
    const child2 = document.createElement('div');
    child1.setAttribute('data-bs-sync-anim', 'hover-glow');
    child2.setAttribute('data-bs-sync-anim', 'hover-glow');
    parent.appendChild(child1);
    parent.appendChild(child2);
    document.body.appendChild(parent);

    const sel1 = getStableSelector(child1);
    const sel2 = getStableSelector(child2);

    expect(sel1).not.toBe(sel2);
    expect(document.querySelector(sel1)).toBe(child1);
    expect(document.querySelector(sel2)).toBe(child2);

    document.body.removeChild(parent);
  });

  test('skips data-anim attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-anim', 'fade');
    expect(getStableSelector(el)).not.toContain('data-anim');
  });

  test('falls back to path selector with tag and classes', () => {
    const parent = document.createElement('section');
    const child = document.createElement('div');
    child.className = 'content box';
    parent.appendChild(child);
    document.body.appendChild(parent);

    const selector = getStableSelector(child);
    expect(selector).toContain('div');
    expect(selector).toContain('.content');
    expect(selector).toContain('.box');

    document.body.removeChild(parent);
  });

  test('excludes anim-* classes from path selector', () => {
    const el = document.createElement('span');
    el.className = 'text anim-fade anim-delay-1';
    document.body.appendChild(el);

    const selector = getStableSelector(el);
    expect(selector).toContain('.text');
    expect(selector).not.toContain('anim-fade');
    expect(selector).not.toContain('anim-delay-1');

    document.body.removeChild(el);
  });

  test('includes :nth-of-type for disambiguation', () => {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('span');
    parent.appendChild(child1);
    parent.appendChild(child2);
    document.body.appendChild(parent);

    const selector = getStableSelector(child2);
    expect(selector).toContain(':nth-of-type(2)');

    document.body.removeChild(parent);
  });
});

describe('broadcastTrigger', () => {
  const mockEmit = jest.fn();

  beforeEach(() => {
    window._danmakuSocket = { emit: mockEmit };
    mockEmit.mockClear();
  });

  afterEach(() => {
    delete window._danmakuSocket;
  });

  test('emits bs:anim:trigger event via socket', () => {
    broadcastTrigger({
      triggerType: 'click',
      selector: '#btn',
      payload: { x: 100, y: 200 }
    });

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      'bs:anim:trigger',
      expect.objectContaining({
        type: 'bs:anim:trigger',
        triggerType: 'click',
        selector: '#btn',
        payload: { x: 100, y: 200 }
      })
    );
  });

  test('message contains a valid UUID id', () => {
    broadcastTrigger({
      triggerType: 'hover',
      selector: '.item',
      payload: null
    });

    const callArgs = mockEmit.mock.calls[0][1];
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(callArgs.id).toMatch(uuidV4Pattern);
  });

  test('message contains a numeric timestamp', () => {
    broadcastTrigger({
      triggerType: 'scroll',
      selector: 'section',
      payload: {}
    });

    const callArgs = mockEmit.mock.calls[0][1];
    expect(typeof callArgs.timestamp).toBe('number');
    expect(callArgs.timestamp).toBeGreaterThan(0);
  });

  test('does nothing when socket is not available', () => {
    delete window._danmakuSocket;

    expect(() => {
      broadcastTrigger({
        triggerType: 'click',
        selector: '#btn',
        payload: {}
      });
    }).not.toThrow();
  });
});
