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

  test('warm mode → accent chosen from warm palette only', () => {
    const warm = ['#ff8c1a', '#e8362f', '#ffd23f'];
    const { accent } = pickAccent([17, 17, 24], 'warm');
    expect(warm).toContain(accent.toLowerCase());
  });

  test('cool mode → accent chosen from cool palette only', () => {
    const cool = ['#16c2ff', '#4d7cff', '#2ee676'];
    const { accent } = pickAccent([17, 17, 24], 'cool');
    expect(cool).toContain(accent.toLowerCase());
  });

  test('hc mode → black on light bg, white on dark bg', () => {
    expect(pickAccent([255, 255, 255], 'hc').accent).toBe('#111111');
    expect(pickAccent([17, 17, 24], 'hc').accent).toBe('#ffffff');
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
