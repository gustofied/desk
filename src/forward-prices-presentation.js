import { area, interpolateRgb, line, curveMonotoneX, scaleLinear, ticks, utcFormat } from 'd3';
import { forwardContours, nearestContour } from './forward-contours.js';
import { animateChartDraw, animateChartSupport, cancelChartMotion } from './chart-motion.js';
import { viewArtifactHeaderMarkup } from './view-artifact-header.js';

const WIDTH = 1200;
const money = value => `$${value.toFixed(2)}`;
const month = seconds => utcFormat('%b %y')(new Date(seconds * 1000));
const day = seconds => utcFormat('%d %b')(new Date(seconds * 1000));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function renderForwardPricesSvg(model, options = {}) {
  const chart = markup(model, options);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${chart.height}" viewBox="0 0 1200 ${chart.height}" role="img" aria-label="${esc(chart.label)}">${chart.inner}</svg>`;
}

export function paintForwardPricesChart(svg, model, options = {}) {
  if (!svg) return;
  cancelChartMotion(svg);
  const height = options.compact ? 675 : svg.clientWidth > 0 && svg.clientHeight > 0
    ? WIDTH * svg.clientHeight / svg.clientWidth : 675;
  const chart = markup(model, { ...options, height, mobile: svg.clientWidth > 0 && svg.clientWidth < 640 });
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${chart.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', options.interactive ? 'group' : 'img');
  svg.setAttribute('aria-label', chart.label);
  svg.innerHTML = chart.inner;
  if (options.decorative) svg.setAttribute('aria-hidden', 'true');
  else svg.removeAttribute('aria-hidden');
  const root = svg.querySelector('[data-forward-chart]');
  if (options.interactive) {
    root.setAttribute('tabindex', '0');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Forward quotes. Arrow keys inspect delivery months and quote dates.');
    let row = model.observations.length - 1, col = 0;
    const cursor = root.querySelector('[data-forward-cursor]');
    const readout = root.querySelector('[data-forward-readout]');
    const regions = [...root.querySelectorAll('[data-forward-region]')].reverse().map(node => {
      const fill = node.getAttribute('fill');
      node.style.transition = options.reducedMotion ? 'none' : 'fill 200ms cubic-bezier(0.32,0.72,0,1)';
      return { node, fill, active: interpolateRgb(fill, options.colors.line)(.12) };
    });
    let activeRegion = null;
    const highlightRegion = region => {
      if (activeRegion === region) return;
      if (activeRegion) activeRegion.node.style.fill = activeRegion.fill;
      activeRegion = region;
      if (region) region.node.style.fill = region.active;
    };
    // Cache a fine hit mesh once; place the marker on the original SVG curve.
    const curves = chart.history ? [] : [...root.querySelectorAll('path[data-forward-series]')].map(node => {
      const length = node.getTotalLength(), count = Math.ceil(length / 4);
      return { node, length, key: Number(node.dataset.forwardSeries), points: Array.from({length: count+1}, (_, i) => {
        const p = node.getPointAtLength(length*i/count); return [p.x, p.y];
      }) };
    });
    const moveMarker = point => {
      cursor.removeAttribute('visibility');
      cursor.querySelector('circle').setAttribute('cx', point.x);
      cursor.querySelector('circle').setAttribute('cy', point.y);
    };
    root.querySelectorAll('[data-forward-series]').forEach(node => {
      node.style.transition = options.reducedMotion ? 'none' : 'opacity 200ms cubic-bezier(0.32,0.72,0,1)';
    });
    const emphasize = key => {
      root.querySelectorAll('[data-forward-series]').forEach(node => {
        const active = key === null || node.dataset.forwardSeries === String(key);
        node.style.opacity = active ? '1' : '.3';
        if (!chart.history && node.tagName.toLowerCase() === 'path') {
          node.setAttribute('stroke-opacity', active ? '1' : '.45');
          node.setAttribute('stroke-width', active ? '4' : '2');
        }
      });
    };
    const selectRow = index => {
      row = index;
      root.querySelectorAll('[data-forward-date]').forEach(node => {
        const selected = Number(node.dataset.forwardDate) === row;
        node.setAttribute('aria-pressed', String(selected));
        node.setAttribute('text-decoration', selected ? 'underline' : 'none');
      });
      emphasize(row);
      root.querySelector('[data-forward-area]').setAttribute('d', chart.curveArea(model.values[row]));
      root.querySelectorAll('[data-forward-price]').forEach(node => {
        const i = Number(node.dataset.forwardPrice);
        node.textContent = money(model.values[row][i]);
        node.setAttribute('y', chart.y(model.values[row][i]) - 48);
      });
    };
    root.querySelectorAll('[data-forward-date]').forEach(node => {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Select curve quoted ${day(model.observations[Number(node.dataset.forwardDate)])}`);
      node.addEventListener('click', event => { event.stopPropagation(); selectRow(Number(node.dataset.forwardDate)); show(); });
      node.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        selectRow(Number(node.dataset.forwardDate)); show();
      });
    });
    const show = () => {
      const x = chart.x(model.deliveries[col]);
      const y = chart.history ? chart.y(model.observations[row]) : chart.y(model.values[row][col]);
      moveMarker({ x, y });
      root.querySelector('[data-forward-readout]').textContent = `${day(model.observations[row])} → ${month(model.deliveries[col])}   ${money(model.values[row][col])} / GPU-h`;
    };
    const clear = (keepRegion = false) => {
      cursor.setAttribute('visibility', 'hidden');
      readout.textContent = chart.readout;
      emphasize(chart.history ? null : row);
      if (!keepRegion) highlightRegion(null);
    };
    root.addEventListener('pointermove', event => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      if (event.target.closest('[data-forward-date]')) { clear(); return; }
      highlightRegion(regions.find(region => region.node.isPointInFill(point)) || null);
      const hit = nearestContour(chart.history ? chart.pickLines : curves, point);
      if (!hit.position || hit.distance * Math.hypot(matrix.a, matrix.b) >= 24) { clear(true); return; }
      let position = hit.position;
      if (!chart.history) {
        const curve = curves.find(curve => curve.key === hit.key);
        let lo = 0, hi = curve.length;
        for (let i = 0; i < 20; i++) {
          const mid = (lo+hi)/2;
          if (curve.node.getPointAtLength(mid).x < position.x) lo = mid; else hi = mid;
        }
        position = curve.node.getPointAtLength((lo+hi)/2);
      }
      moveMarker(position);
      emphasize(hit.key);
      readout.textContent = chart.history ? `${money(hit.key)} / GPU-h`
        : `${day(model.observations[hit.key])} → ${month(chart.x.invert(position.x))}   ${money(chart.y.invert(position.y))} / GPU-h`;
    });
    root.addEventListener('pointerleave', () => clear());
    root.addEventListener('focus', show);
    root.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowLeft') col--;
      if (event.key === 'ArrowRight') col++;
      if (event.key === 'ArrowUp' && chart.history) row++;
      if (event.key === 'ArrowDown' && chart.history) row--;
      if (event.key === 'Home') col = 0;
      if (event.key === 'End') col = model.deliveries.length - 1;
      col = Math.max(0, Math.min(model.deliveries.length - 1, col));
      row = Math.max(0, Math.min(model.observations.length - 1, row));
      show();
    });
  }
  if (!options.reducedMotion && !options.decorative) {
    svg.querySelectorAll('[data-forward-band]').forEach((node, i) => animateChartSupport(node, { delay: i * 45 }));
    svg.querySelectorAll('[data-forward-line]').forEach((node, i) => animateChartDraw(node, { delay: i * 45 }));
    svg.querySelectorAll('[data-forward-label]').forEach((node, i) => animateChartSupport(node, { delay: 280 + i * 45 }));
  }
}

function markup(model, { colors, compact = false, gallery = false, title, height = 675, mobile = false } = {}) {
  const history = model.range !== 'now';
  const palette = { ...colors, line: colors.theme === 'dark' ? colors.line : '#181818' };
  const font = mobile ? 36 : 24;
  const left = 0;
  const right = WIDTH;
  const inset = mobile ? 40 : 32;
  const top = 0;
  const bottom = height;
  const x = scaleLinear().domain([model.deliveries[0], model.deliveries.at(-1)]).range([left, right]).clamp(true);
  const rows = [...new Set([model.observations.length-1, Math.max(0, model.observations.length-2), Math.max(0, model.observations.length-4)])];
  const curveValues = rows.flatMap(row => model.values[row]);
  const curveLow = Math.min(...curveValues), curveHigh = Math.max(...curveValues);
  const y = scaleLinear().domain(history ? [model.observations[0], model.observations.at(-1)] : [curveLow - 0.12, curveHigh + 0.12]).range([bottom, history ? top : gallery ? 224 : 160]).clamp(true);
  const fraction = value => (value - model.low) / Math.max(0.01, model.high - model.low);
  const shade = value => palette.theme === 'dark'
    ? interpolateRgb(palette.paper, palette.line)(0.08 + 0.24 * fraction(value))
    : interpolateRgb(palette.paper, interpolateRgb(colors.accent || colors.line, '#181818')(0.32))(0.12 + 0.72 * fraction(value));
  const levels = ticks(model.low, model.high, 6).filter(v => v > model.low && v < model.high);
  const path = line().x(p => p[0]).y(p => p[1]);
  const curveArea = area().x((v, i) => x(model.deliveries[i])).y0(bottom).y1(v => y(v)).curve(curveMonotoneX);
  const label = `${model.gpu} forward prices. ${history ? 'Quote date by delivery month; contour labels in USD per GPU-hour.' : 'Latest curve by delivery month, in USD per GPU-hour.'} ${model.contract.region}, ${model.contract.term}, ${model.contract.quantity} GPUs. Example quotes.`;
  const readout = `${model.contract.region}   ${model.contract.term}   ${model.contract.quantity} GPUs`;
  const geometry = [];
  const pickLines = [];
  if (history) {
    geometry.push(`<rect data-forward-region="${model.low}" x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" fill="${shade(model.low)}"/>`);
    const grid = [...model.values].reverse();
    const indexTime = (values, position) => {
      const p = Math.max(0, Math.min(values.length - 1, position));
      const lo = Math.floor(p), hi = Math.min(values.length - 1, lo + 1);
      return values[lo] + (values[hi] - values[lo]) * (p - lo);
    };
    const reversedDates = [...model.observations].reverse();
    const projected = forwardContours(grid, levels,
      ([gx, gy]) => [x(indexTime(model.deliveries, gx - .5)), y(indexTime(reversedDates, gy - .5))],
      [left, top, right, bottom]);
    // Paint all fills first so higher bands cannot cover neighboring strokes.
    for (const contour of projected) geometry.push(`<path data-forward-band="" data-forward-region="${contour.value}" d="${contour.fill}" fill="${shade(contour.value)}"/>`);
    const labels = [];
    for (const contour of projected) {
      const level = contour.value;
      for (const { points, d } of contour.paths) {
        pickLines.push({ key: level, points });
        geometry.push(`<path data-forward-series="${level}" data-forward-line="" d="${d}" fill="none" stroke="${palette.line}" stroke-width="${gallery ? 4 : 3}" stroke-linejoin="round"/>`);
      }
      // Label an actual contour segment, outside the heading and date labels.
      const candidates = contour.paths.flatMap(({ points }) => points.slice(1).map((b, i) => {
        const a = points[i], p = [(a[0]+b[0])/2, (a[1]+b[1])/2];
        return { p, angle: Math.atan2(b[1]-a[1], b[0]-a[0])*180/Math.PI,
          length: Math.hypot(b[0]-a[0], b[1]-a[1]) };
      })).filter(({p, length}) => length > font*2 && p[0] > 144 && p[0] < right-96 &&
        p[1] > (gallery ? 256 : 176) && p[1] < bottom-48 && labels.every(q => Math.hypot(p[0]-q[0], p[1]-q[1]) > 96));
      candidates.sort((a, b) => Math.abs(a.p[1]-height*.55) - Math.abs(b.p[1]-height*.55));
      if (!candidates.length) continue;
      let { p, angle } = candidates[0];
      labels.push(p);
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      geometry.push(`<text data-forward-series="${level}" data-forward-label="" transform="translate(${p[0]} ${p[1]}) rotate(${angle})" dy=".35em" text-anchor="middle" font-size="${gallery ? 32 : font}" fill="${palette.line}" stroke="${shade(level)}" stroke-width="8" stroke-linejoin="round" style="paint-order:stroke fill">${money(level)}</text>`);
    }
  } else {
    const points = model.latest.map((v, i) => [x(model.deliveries[i]), y(v)]);
    geometry.push(`<path data-forward-area="" data-forward-band="" d="${curveArea(model.latest)}" fill="${shade(model.low)}"/>`);
    [...rows].reverse().forEach(row => {
      const d = path.curve(curveMonotoneX)(model.values[row].map((v, i) => [x(model.deliveries[i]), y(v)]));
      geometry.push(`<path data-forward-series="${row}" data-forward-line="" d="${d}" stroke="${palette.line}" stroke-opacity="${row === rows[0] ? 1 : .45}" stroke-width="${row === rows[0] ? 4 : 2}" fill="none"/>`);
    });
    if (!gallery) [0, Math.floor(points.length / 2), points.length-1].forEach(i => geometry.push(`<text data-forward-price="${i}" x="${Math.max(inset, Math.min(WIDTH-inset, points[i][0]))}" y="${points[i][1]-48}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" fill="${palette.line}" font-size="${font}">${money(model.latest[i])}</text>`));
  }
  const axes = [];
  if (!gallery) {
    if (history) [0, Math.floor(model.observations.length/2), model.observations.length-1].forEach(i => {
      const band = levels.filter(level => level <= model.values[i][0]).at(-1) ?? model.low;
      axes.push(`<text x="${inset}" y="${Math.max(144, Math.min(bottom-16, y(model.observations[i])+8))}" fill="${palette.line}" stroke="${shade(band)}" stroke-width="8" stroke-linejoin="round" style="paint-order:stroke fill">${day(model.observations[i])}</text>`);
    });
  }
  const header = gallery ? viewArtifactHeaderMarkup({ title: title || `${model.gpu} forwards`, context: history ? 'HISTORY' : 'CURVE', headline: money(model.latest[0]), colors: palette, compact: true })
    : `<text x="${inset}" y="${mobile ? 64 : 48}" font-family="Geist, sans-serif" font-weight="600" font-size="${mobile ? 48 : 36}" fill="${palette.line}">${esc(title || `${model.gpu} forwards`)}</text><text x="${right-inset}" y="${mobile ? 64 : 48}" text-anchor="end" font-size="${font}" fill="${palette.text}">USD / GPU-h</text><text data-forward-readout="" x="${inset}" y="${mobile ? 112 : 96}" font-size="${font}" fill="${palette.text}">${esc(readout)}</text>`;
  const dates = !history && !gallery ? rows.map((row, i) => `<text data-forward-date="${row}" aria-pressed="${i === 0}" x="${right-inset-i*(mobile ? 192 : 128)}" y="${mobile ? 152 : 96}" text-anchor="end" font-size="${font}" fill="${palette.line}" text-decoration="${i === 0 ? 'underline' : 'none'}" style="cursor:pointer">${day(model.observations[row])}</text>`).join('') : '';
  return { height, history, x, y, readout, label, pickLines, curveArea, inner: `<rect width="1200" height="${height}" fill="${palette.paper}"/><g data-forward-chart="" font-family="Geist Mono, monospace" font-weight="500">${geometry.join('')}<g fill="${palette.text}" font-size="${font}">${axes.join('')}</g>${header}${dates}${gallery ? '' : `<g data-forward-cursor="" visibility="hidden" pointer-events="none"><circle r="6" fill="${palette.paper}" stroke="${palette.line}" stroke-width="3"/></g>`}</g>` };
}
