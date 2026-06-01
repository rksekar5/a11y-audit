import { test, expect } from '@playwright/test';
import { parseColor, contrastRatio, alphaBlend } from '../utils/contrast-ratio';

/**
 * Unit tests for contrast-ratio.ts — CSS Color Level 4 parsing
 */
test.describe('Unit: Color Parsing', () => {
  test('parses rgb()', () => {
    const color = parseColor('rgb(255, 0, 128)');
    expect(color).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  test('parses rgba()', () => {
    const color = parseColor('rgba(100, 200, 50, 0.5)');
    expect(color).toEqual({ r: 100, g: 200, b: 50, a: 0.5 });
  });

  test('parses hex #RGB', () => {
    const color = parseColor('#f0a');
    expect(color).toEqual({ r: 255, g: 0, b: 170, a: 1 });
  });

  test('parses hex #RRGGBB', () => {
    const color = parseColor('#ff6600');
    expect(color).toEqual({ r: 255, g: 102, b: 0, a: 1 });
  });

  test('parses named colors', () => {
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  test('parses hsl()', () => {
    const color = parseColor('hsl(0, 100%, 50%)');
    expect(color).toBeTruthy();
    expect(color!.r).toBe(255);
    expect(color!.g).toBe(0);
    expect(color!.b).toBe(0);
  });

  test('parses hsl() with degrees', () => {
    const color = parseColor('hsl(120deg, 100%, 50%)');
    expect(color).toBeTruthy();
    expect(color!.r).toBe(0);
    expect(color!.g).toBe(255);
    expect(color!.b).toBe(0);
  });

  test('parses hsla() with alpha', () => {
    const color = parseColor('hsla(240, 100%, 50%, 0.5)');
    expect(color).toBeTruthy();
    expect(color!.b).toBe(255);
    expect(color!.a).toBe(0.5);
  });

  test('parses oklch()', () => {
    // oklch(0.7 0.15 180) ≈ a teal-ish color
    const color = parseColor('oklch(0.7 0.15 180deg)');
    expect(color).toBeTruthy();
    expect(color!.r).toBeGreaterThanOrEqual(0);
    expect(color!.r).toBeLessThanOrEqual(255);
    expect(color!.g).toBeGreaterThanOrEqual(0);
    expect(color!.b).toBeGreaterThanOrEqual(0);
  });

  test('parses oklch() with percentage lightness', () => {
    const color = parseColor('oklch(70% 0.15 90deg)');
    expect(color).toBeTruthy();
    expect(color!.a).toBe(1);
  });

  test('parses color-mix() in srgb', () => {
    const color = parseColor('color-mix(in srgb, red 50%, blue)');
    expect(color).toBeTruthy();
    // 50% red + 50% blue = purple-ish
    expect(color!.r).toBeGreaterThan(100);
    expect(color!.b).toBeGreaterThan(100);
  });

  test('returns null for transparent', () => {
    expect(parseColor('transparent')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseColor('')).toBeNull();
  });

  test('contrast ratio black on white = 21:1', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(21, 0);
  });

  test('contrast ratio same color = 1:1', () => {
    const ratio = contrastRatio({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 });
    expect(ratio).toBeCloseTo(1, 1);
  });

  test('alpha blending 50% black on white', () => {
    const result = alphaBlend({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255 });
    expect(result.r).toBe(128);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });
});
