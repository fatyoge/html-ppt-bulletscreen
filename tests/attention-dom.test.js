/**
 * @jest-environment jsdom
 */
jest.useFakeTimers();
const { renderAt, sampleBgRgb, initSpeakerUI, getState, resetState } = require('../public/attention');

beforeEach(() => {
  document.body.innerHTML = '';
  resetState();
  jest.useFakeTimers();
});

describe('renderAt', () => {
  test('creates layer + ping marker at point', () => {
    renderAt({ xPct: 50, yPct: 50, effect: 'ping', accent: '#ff8c1a', core: '#ffffff' });
    const layer = document.getElementById('bs-attention-layer');
    expect(layer).not.toBeNull();
    const marker = layer.querySelector('.bs-attn--ping');
    expect(marker).not.toBeNull();
    expect(marker.style.left).toBe('50%');
    expect(marker.style.top).toBe('50%');
    expect(marker.querySelectorAll('.bs-attn__core')).toHaveLength(1);
    expect(marker.querySelectorAll('.bs-attn__ring')).toHaveLength(1);
  });

  test('ripple has 3 rings', () => {
    renderAt({ xPct: 10, yPct: 20, effect: 'ripple', accent: '#16c2ff', core: '#06314a' });
    const marker = document.querySelector('.bs-attn--ripple');
    expect(marker.querySelectorAll('.bs-attn__ring')).toHaveLength(3);
  });

  test('auto-removes after 1.5s', () => {
    renderAt({ xPct: 50, yPct: 50, effect: 'ping', accent: '#ff8c1a', core: '#ffffff' });
    expect(document.querySelector('.bs-attn')).not.toBeNull();
    jest.advanceTimersByTime(1600);
    expect(document.querySelector('.bs-attn')).toBeNull();
  });
});

describe('sampleBgRgb', () => {
  test('returns null when nothing opaque found (empty jsdom)', () => {
    expect(sampleBgRgb(50, 50)).toBeNull();
  });

  test('reads opaque inline background at the point', () => {
    const el = document.createElement('div');
    el.style.backgroundColor = 'rgb(255, 140, 26)';
    document.body.appendChild(el);
    const real = document.elementFromPoint;
    document.elementFromPoint = () => el;
    try {
      expect(sampleBgRgb(50, 50)).toEqual([255, 140, 26]);
    } finally {
      document.elementFromPoint = real;
    }
  });
});

describe('initSpeakerUI', () => {
  test('defaults are ping / auto', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    expect(getState().effect).toBe('ping');
    expect(getState().colorMode).toBe('auto');
  });

  test('clicking 波纹 sets effect to ripple', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const rippleBtn = container.querySelector('.attn-seg[data-kind="effect"] .attn-seg-btn[data-v="ripple"]');
    rippleBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(getState().effect).toBe('ripple');
  });

  test('clicking 暖 sets colorMode to warm', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initSpeakerUI(container);
    const warmBtn = container.querySelector('.attn-seg[data-kind="colorMode"] .attn-seg-btn[data-v="warm"]');
    warmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(getState().colorMode).toBe('warm');
  });
});
