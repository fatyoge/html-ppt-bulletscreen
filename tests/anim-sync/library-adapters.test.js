/**
 * @jest-environment jsdom
 */

// Polyfill CSS.escape for jsdom
if (typeof CSS === 'undefined' || !CSS.escape) {
  global.CSS = global.CSS || {};
  global.CSS.escape = function(str) {
    return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  };
}

describe('library-adapters GSAP', () => {
  let broadcastMock;

  beforeEach(() => {
    jest.useFakeTimers();
    broadcastMock = jest.fn();
    window.BS_ROLE = 'speaker';
    window.BS_AnimSync = {
      isSpeaker: () => window.BS_ROLE === 'speaker',
      getStableSelector: (el) => el.id ? '#' + el.id : 'path',
      broadcastTrigger: broadcastMock
    };
    delete window.gsap;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete window.BS_ROLE;
    delete window.BS_AnimSync;
    delete window.gsap;
  });

  function loadAdapter() {
    // Force re-evaluation by clearing the require cache.
    jest.resetModules();
    require('../../public/anim-sync/library-adapters');
    jest.advanceTimersByTime(200);
  }

  test('gsap.fromTo preserves selector string for multi-element targets', () => {
    const fromToMock = jest.fn();
    const toMock = jest.fn();
    const fromMock = jest.fn();
    window.gsap = { to: toMock, from: fromMock, fromTo: fromToMock };

    loadAdapter();

    window.gsap.fromTo('#grid .cell', { scale: 0 }, { scale: 1, duration: 0.5 });

    expect(fromToMock).toHaveBeenCalledWith('#grid .cell', { scale: 0 }, { scale: 1, duration: 0.5 });
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    const msg = broadcastMock.mock.calls[0][0];
    expect(msg.triggerType).toBe('gsap');
    expect(msg.selector).toBe('#grid .cell');
    expect(msg.payload.method).toBe('fromTo');
  });

  test('gsap.timeline collects chained steps and broadcasts a single timeline message', () => {
    let mockTl;
    const tlToMock = jest.fn(function(targets, vars) {
      // Simulate GSAP mutating the vars object to add a parent reference.
      vars.parent = mockTl;
      return mockTl;
    });
    const tlFromMock = jest.fn(function(targets, vars) {
      vars.parent = mockTl;
      return mockTl;
    });
    const tlFromToMock = jest.fn(function(targets, fromVars, toVars) {
      toVars.parent = mockTl;
      fromVars.parent = mockTl;
      return mockTl;
    });
    mockTl = {
      to: tlToMock,
      from: tlFromMock,
      fromTo: tlFromToMock,
      // Simulate the circular references found in real GSAP Timeline instances.
      _dp: {}
    };
    mockTl._dp._first = mockTl;
    const timelineMock = jest.fn(() => mockTl);
    window.gsap = {
      to: jest.fn(),
      from: jest.fn(),
      fromTo: jest.fn(),
      timeline: timelineMock
    };

    loadAdapter();

    const tl = window.gsap.timeline();
    tl.to('#a', { x: 100 }, '+=0.5')
      .from('#b', { opacity: 0 }, '-=0.2')
      .fromTo('#c', { y: 0 }, { y: 50 }, 0.3);

    // Flush the microtask/timeout used to batch timeline steps.
    jest.runAllTimers();

    expect(broadcastMock).toHaveBeenCalledTimes(1);
    const msg = broadcastMock.mock.calls[0][0];
    expect(msg.triggerType).toBe('gsap-timeline');
    expect(msg.payload.steps).toHaveLength(3);
    expect(msg.payload.steps[0]).toMatchObject({ method: 'to', selector: '#a', position: '+=0.5' });
    expect(msg.payload.steps[1]).toMatchObject({ method: 'from', selector: '#b', position: '-=0.2' });
    expect(msg.payload.steps[2]).toMatchObject({ method: 'fromTo', selector: '#c', position: 0.3 });

    // The parent reference must be stripped so the payload can be serialized.
    expect(msg.payload.steps[0].gsapConfig.parent).toBeUndefined();
    expect(msg.payload.steps[2].gsapConfig.parent).toBeUndefined();
    expect(msg.payload.steps[2].gsapFromConfig.parent).toBeUndefined();
    expect(() => JSON.stringify(msg)).not.toThrow();
  });

  test('gsap.timeline with no chained steps does not broadcast', () => {
    const timelineMock = jest.fn(() => ({
      to: jest.fn(),
      from: jest.fn(),
      fromTo: jest.fn()
    }));
    window.gsap = {
      to: jest.fn(),
      from: jest.fn(),
      fromTo: jest.fn(),
      timeline: timelineMock
    };

    loadAdapter();

    window.gsap.timeline();
    jest.runAllTimers();

    expect(broadcastMock).not.toHaveBeenCalled();
  });
});
