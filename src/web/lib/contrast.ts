export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i;

/** Parses `#rgb`, `#rrggbb`, `rgb(r g b)`, `rgb(r g b / a)` and `rgba(r, g, b, a)`. */
export function parseColor(value: string): RGBA {
  const input = value.trim();
  const hex = HEX.exec(input);
  if (hex) {
    const raw = hex[1] ?? '';
    const digits = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = RGB.exec(input);
  if (rgb) {
    const alphaText = rgb[4];
    let a = 1;
    if (alphaText !== undefined) {
      a = alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
    }
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a };
  }
  throw new Error(`Unsupported colour value: ${value}`);
}

/** Alpha-composites `fg` over an opaque `bg`, returning an opaque colour. */
export function compositeOver(fg: RGBA, bg: RGBA): RGBA {
  const mix = (f: number, b: number) => fg.a * f + (1 - fg.a) * b;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function relativeLuminance(color: RGBA): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

/**
 * WCAG 2.x contrast ratio between two colours. A translucent foreground or
 * background is composited over `backdrop` (defaults to white) first.
 */
export function contrastRatio(foreground: RGBA, background: RGBA, backdrop?: RGBA): number {
  const opaqueBackground =
    background.a < 1 ? compositeOver(background, backdrop ?? { r: 255, g: 255, b: 255, a: 1 }) : background;
  const opaqueForeground =
    foreground.a < 1 ? compositeOver(foreground, opaqueBackground) : foreground;
  const l1 = relativeLuminance(opaqueForeground);
  const l2 = relativeLuminance(opaqueBackground);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
