/**
 * WCAG 2.x Contrast Ratio Calculation
 * Based on the relative luminance formula from WCAG 2.1 §1.4.3
 * https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
 */

export interface RGBColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a?: number; // 0-1 (alpha)
}

export interface ContrastResult {
  ratio: number;
  meetsAA: boolean; // 4.5:1 for normal text, 3:1 for large text
  meetsAAA: boolean; // 7:1 for normal text, 4.5:1 for large text
  meetsAALarge: boolean; // 3:1 for large text (>=18pt or >=14pt bold)
  foreground: string;
  background: string;
}

export interface ElementContrastInfo {
  selector: string;
  html: string;
  foregroundColor: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  isLargeText: boolean;
  contrastRatio: number;
  meetsWCAG_AA: boolean;
  meetsWCAG_AAA: boolean;
  required: number; // minimum required ratio
}

/**
 * Convert sRGB component (0-255) to linear RGB
 * Per WCAG 2.1 relative luminance definition
 */
function sRGBtoLinear(value: number): number {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Calculate relative luminance of a color
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R, G, B are linearized sRGB values
 */
export function relativeLuminance(color: RGBColor): number {
  const r = sRGBtoLinear(color.r);
  const g = sRGBtoLinear(color.g);
  const b = sRGBtoLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors
 * Ratio = (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color
 */
export function contrastRatio(color1: RGBColor, color2: RGBColor): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse a CSS color string into RGB values.
 * Handles: rgb(), rgba(), hex (#RGB, #RRGGBB, #RRGGBBAA), named colors
 */
export function parseColor(color: string): RGBColor | null {
  if (!color || color === 'transparent') return null;

  const trimmed = color.trim().toLowerCase();

  // Handle rgb/rgba
  const rgbMatch = trimmed.match(
    /rgba?\(\s*(\d+(?:\.\d+)?%?)\s*[,\s]\s*(\d+(?:\.\d+)?%?)\s*[,\s]\s*(\d+(?:\.\d+)?%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)/
  );
  if (rgbMatch) {
    const parseComponent = (val: string) => {
      if (val.endsWith('%')) return Math.round(parseFloat(val) * 2.55);
      return Math.round(parseFloat(val));
    };
    return {
      r: Math.min(255, Math.max(0, parseComponent(rgbMatch[1]))),
      g: Math.min(255, Math.max(0, parseComponent(rgbMatch[2]))),
      b: Math.min(255, Math.max(0, parseComponent(rgbMatch[3]))),
      a: rgbMatch[4] ? (rgbMatch[4].endsWith('%') ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4])) : 1,
    };
  }

  // Handle hex
  const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    } else if (hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: parseInt(hex[3] + hex[3], 16) / 255,
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: 1,
      };
    } else if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
        a: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
  }

  // Named colors (common subset)
  const namedColors: Record<string, RGBColor> = {
    white: { r: 255, g: 255, b: 255 },
    black: { r: 0, g: 0, b: 0 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    yellow: { r: 255, g: 255, b: 0 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    silver: { r: 192, g: 192, b: 192 },
    navy: { r: 0, g: 0, b: 128 },
    orange: { r: 255, g: 165, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    teal: { r: 0, g: 128, b: 128 },
    maroon: { r: 128, g: 0, b: 0 },
    olive: { r: 128, g: 128, b: 0 },
    aqua: { r: 0, g: 255, b: 255 },
    fuchsia: { r: 255, g: 0, b: 255 },
    lime: { r: 0, g: 255, b: 0 },
  };

  if (namedColors[trimmed]) {
    return { ...namedColors[trimmed], a: 1 };
  }

  return null;
}

/**
 * Blend a semi-transparent foreground color onto a background
 * using alpha compositing (source-over)
 */
export function alphaBlend(foreground: RGBColor, background: RGBColor): RGBColor {
  const alpha = foreground.a ?? 1;
  if (alpha >= 1) return foreground;

  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
    a: 1,
  };
}

/**
 * Determine if text is "large" per WCAG definition:
 * - 18pt (24px) or larger regular text
 * - 14pt (18.67px) or larger bold text (font-weight >= 700)
 */
export function isLargeText(fontSize: string, fontWeight: string): boolean {
  const size = parseFloat(fontSize); // assumes px
  const weight = parseInt(fontWeight) || (fontWeight === 'bold' ? 700 : 400);
  const isBold = weight >= 700;

  if (isBold) return size >= 18.67; // 14pt
  return size >= 24; // 18pt
}

/**
 * Get the minimum required contrast ratio based on WCAG level and text size
 */
export function getRequiredRatio(level: 'AA' | 'AAA', largeText: boolean): number {
  if (level === 'AAA') return largeText ? 4.5 : 7;
  return largeText ? 3 : 4.5;
}

/**
 * Full contrast check returning a structured result
 */
export function checkContrast(
  foreground: RGBColor,
  background: RGBColor,
  fgColorStr: string,
  bgColorStr: string
): ContrastResult {
  // Apply alpha blending if foreground is semi-transparent
  const effectiveFg = alphaBlend(foreground, background);
  const ratio = contrastRatio(effectiveFg, background);

  return {
    ratio: Math.round(ratio * 100) / 100,
    meetsAA: ratio >= 4.5,
    meetsAAA: ratio >= 7,
    meetsAALarge: ratio >= 3,
    foreground: fgColorStr,
    background: bgColorStr,
  };
}

/**
 * Script to inject into page.evaluate() for extracting element contrast data.
 * Returns computed colors by walking up the DOM for effective background.
 */
export const CONTRAST_EXTRACTION_SCRIPT = `(() => {
  function getEffectiveBackgroundColor(el) {
    let current = el;
    let bgColor = null;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const bg = style.backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        bgColor = bg;
        break;
      }
      current = current.parentElement;
    }
    // Default to white if no background found
    return bgColor || 'rgb(255, 255, 255)';
  }

  function getContrastData() {
    const textElements = document.querySelectorAll(
      'p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button, input, select, textarea, blockquote, figcaption, dt, dd, cite, small, strong, em, code, pre'
    );

    const results = [];
    const processed = new Set();

    for (const el of textElements) {
      // Skip hidden elements
      const htmlEl = el;
      if (!htmlEl.offsetParent && htmlEl.tagName !== 'BODY') continue;

      // Skip empty text elements
      const text = el.textContent?.trim();
      if (!text || text.length === 0) continue;

      const style = window.getComputedStyle(el);
      const color = style.color;
      const bgColor = getEffectiveBackgroundColor(el);
      const fontSize = style.fontSize;
      const fontWeight = style.fontWeight;

      // Deduplicate by color+bg+size combination
      const key = color + '|' + bgColor + '|' + fontSize + '|' + fontWeight;
      if (processed.has(key)) continue;
      processed.add(key);

      // Generate selector
      let selector = el.tagName.toLowerCase();
      if (el.id) selector = '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/)[0];
        if (cls) selector += '.' + cls;
      }

      results.push({
        selector,
        html: el.outerHTML.substring(0, 150),
        color,
        bgColor,
        fontSize,
        fontWeight,
        text: text.substring(0, 50),
      });

      if (results.length >= 100) break;
    }
    return results;
  }
  return getContrastData();})()
`;
