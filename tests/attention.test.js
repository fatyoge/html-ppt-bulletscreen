const { pickAccent, relativeLuminance, hueDistance, hexToRgb } = require('../public/attention');

describe('pickAccent', () => {
  test('deep background + auto → bright accent (high luminance)', () => {
    const { accent } = pickAccent([17, 17, 24], 'auto');
    expect(relativeLuminance(hexToRgb(accent))).toBeGreaterThan(0.5);
  });

  test('light background + auto → dark accent (low luminance)', () => {
    const { accent } = pickAccent([255, 255, 255], 'auto');
    expect(relativeLuminance(hexToRgb(accent))).toBeLessThan(0.35);
  });

  test('same-hue trap: orange background + auto → not orange, far hue', () => {
    const { accent } = pickAccent([255, 140, 26], 'auto');
    expect(accent.toLowerCase()).not.toBe('#ff8c1a');
    expect(hueDistance(hexToRgb(accent), [255, 140, 26])).toBeGreaterThan(90);
  });

  test('fixed mode → uses the speaker-chosen color, core derived', () => {
    const light = pickAccent([17, 17, 24], 'fixed', '#ffcc00');
    expect(light.accent).toBe('#ffcc00');
    expect(light.core).toBe('#111111');           // 浅色 → 深芯

    const dark = pickAccent([255, 255, 255], 'fixed', '#4488ff');
    expect(dark.accent).toBe('#4488ff');
    expect(dark.core).toBe('#ffffff');            // 深色 → 浅芯
  });

  test('fixed mode with invalid color → falls back to auto', () => {
    const r = pickAccent([17, 17, 24], 'fixed', 'nope');
    expect(r.accent).toMatch(/^#[0-9a-f]{6}$/i);  // auto 候选
  });

  test('invalid input does not throw and returns strings', () => {
    expect(() => pickAccent(null, 'auto')).not.toThrow();
    expect(() => pickAccent([], 'auto')).not.toThrow();
    expect(() => pickAccent([17, 17, 24], 'weird')).not.toThrow();
    const r = pickAccent(null, 'auto');
    expect(typeof r.accent).toBe('string');
    expect(typeof r.core).toBe('string');
  });
});

describe('color helpers', () => {
  test('relativeLuminance extremes', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  test('hexToRgb parses #rrggbb', () => {
    expect(hexToRgb('#ff8c1a')).toEqual([255, 140, 26]);
    expect(hexToRgb('nope')).toBeNull();
  });
});
