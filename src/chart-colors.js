import { interpolateCividis, interpolateMagma, interpolateRgb, interpolateViridis, rgb } from 'd3';

export const CHART_COLORMAPS = Object.freeze([
  { id: 'current', label: 'Match Desk' },
  { id: 'cividis', label: 'Cividis' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'magma', label: 'Magma' },
].map(Object.freeze));

const interpolators = { cividis: interpolateCividis, viridis: interpolateViridis, magma: interpolateMagma };

export function normalizeColormap(value) {
  const id = String(value ?? '').trim().toLowerCase();
  return CHART_COLORMAPS.some(option => option.id === id) ? id : 'current';
}

export function colormapColor(id, fraction) {
  const interpolate = interpolators[normalizeColormap(id)];
  return interpolate ? interpolate(Math.max(0, Math.min(1, Number(fraction) || 0))) : null;
}

export function colormapGradient(id, { paper = '#ffffff', line = '#849095' } = {}) {
  const stops = Array.from({ length: 9 }, (_, index) => {
    const fraction = index / 8;
    const color = colormapColor(id, fraction) ?? interpolateRgb(paper, line)(.12 + .88 * fraction);
    return `${color} ${fraction * 100}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function luminance(color) {
  const { r, g, b } = rgb(color);
  const linear = channel => channel / 255 <= .04045
    ? channel / 255 / 12.92 : ((channel / 255 + .055) / 1.055) ** 2.4;
  return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
}

// Contour labels sit on their own fill, not necessarily on the card paper.
export function colormapInk(color) {
  return luminance(color) > .179 ? '#000000' : '#ffffff';
}

function readableColor(color, paper, opacity, minimum) {
  const paperLight = luminance(paper);
  const ink = paperLight > .179 ? '#000000' : '#ffffff';
  for (let step = 0; step <= 24; step += 1) {
    const candidate = interpolateRgb(color, ink)(step / 24);
    const light = luminance(interpolateRgb(paper, candidate)(opacity));
    const contrast = (Math.max(light, paperLight) + .05) / (Math.min(light, paperLight) + .05);
    if (contrast >= minimum || step === 24) return candidate;
  }
}

// Lines retain one color per series. Only value surfaces use the full ramp.
// Preserve Current verbatim: old cards and published previews must not change.
export function withChartColormap(colors, id) {
  const colormap = normalizeColormap(id);
  if (colormap === 'current') return colors;
  const dark = colors.theme === 'dark';
  const line = readableColor(colormapColor(colormap, dark ? .8 : .24), colors.paper, .68, 4.5);
  const secondary = readableColor(colormapColor(colormap, dark ? .46 : .52), colors.paper, .64, 4.5);
  return { ...colors, line, secondary, area: secondary, accent: line };
}
