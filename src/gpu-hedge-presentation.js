import { area, easeCubicOut, interpolateString, line, scaleLinear, timer } from 'd3';
import { animateChartDraw, animateChartSupport, cancelChartMotion } from './chart-motion.js';
import { viewArtifactHeaderMarkup } from './view-artifact-header.js';

const WIDTH = 1200;
const DEFAULT_HEIGHT = 675;
const chartUpdates = new WeakMap();
const dollar = value => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`;
const profit = value => {
  const magnitude = Math.abs(value);
  const units = [[1, ''], [1e3, 'k'], [1e6, 'm'], [1e9, 'b'], [1e12, 't']];
  let index = units.findLastIndex(([divisor]) => magnitude >= divisor);
  index = Math.max(0, index);
  if (index < units.length-1 && Number((magnitude / units[index][0]).toFixed(2)) >= 1000) index++;
  const [divisor, suffix] = units[index];
  const amount = Number((magnitude / divisor).toFixed(2));
  return `${value < 0 ? '−' : ''}$${amount}${suffix}`;
};
const coordinate = value => Number(value.toFixed(3));
const priceLabel = value => Math.abs(value) >= 1000 ? profit(value) : dollar(value);

export function renderGpuHedgeSvg(model, options = {}) {
  const chart = markup(model, options);
  const accessibility = options.decorative ? 'aria-hidden="true"' : `role="img" aria-label="${esc(chart.label)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${chart.height}" viewBox="0 0 ${WIDTH} ${chart.height}" ${accessibility}>${chart.inner}</svg>`;
}

export function cancelGpuHedgeMotion(svg) {
  chartUpdates.get(svg)?.cancel?.();
  chartUpdates.delete(svg);
  cancelChartMotion(svg);
}

export function paintGpuHedgeChart(svg, model, options = {}) {
  if (!svg) return;
  const previous = chartUpdates.get(svg);
  const motion = options.reducedMotion || options.decorative ? 'none'
    : options.motion ?? (previous ? 'update' : 'reveal');
  const displayed = motion === 'update' ? captureGeometry(svg) : null;
  previous?.cancel?.();
  cancelChartMotion(svg);
  const height = options.compact ? DEFAULT_HEIGHT : svg.clientWidth > 0 && svg.clientHeight > 0
    ? Math.max(420, WIDTH * svg.clientHeight / svg.clientWidth) : DEFAULT_HEIGHT;
  const chart = markup(model, { ...options, height, mobile: svg.clientWidth > 0 && svg.clientWidth < 640 });
  const canInteract = options.interactive && !options.gallery && !options.decorative;
  const wasFocused = svg.querySelector('[data-gpu-hedge-chart]') === svg.ownerDocument?.activeElement;
  const canMorph = motion === 'update' && !wasFocused && previous?.height === chart.height
    && previous?.gallery === Boolean(options.gallery) && previous?.mobile === chart.mobile;
  const update = { height: chart.height, gallery: Boolean(options.gallery), mobile: chart.mobile };
  chartUpdates.set(svg, update);
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${chart.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', canInteract ? 'group' : 'img');
  svg.setAttribute('aria-label', chart.label);
  if (options.decorative) svg.setAttribute('aria-hidden', 'true');
  else svg.removeAttribute('aria-hidden');
  svg.innerHTML = chart.inner;
  const root = svg.querySelector('[data-gpu-hedge-chart]');
  if (canInteract) {
    root.setAttribute('tabindex', '0');
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', `${model.gpu} settlement price. Arrow keys inspect hedged and unhedged profit.`);
    root.setAttribute('aria-valuemin', String(model.domain[0]));
    root.setAttribute('aria-valuemax', String(model.domain[1]));
    root.setAttribute('aria-orientation', 'horizontal');
    const cursor = root.querySelector('[data-gpu-hedge-cursor]');
    const readout = root.querySelector('[data-gpu-hedge-readout]');
    let settlement = clamp(model.rate, ...model.domain);
    let touchGesture = null;
    const show = (value, showCursor = true) => {
      // Inspection always uses the exact current model, even if a change was
      // still moving. It never waits for an entrance or geometry transition.
      update.finish?.();
      cancelChartMotion(svg);
      settlement = clamp(value, ...model.domain);
      const description = readoutText(model, settlement);
      const values = model.profitAt(settlement);
      readout.querySelector('[data-gpu-hedge-settlement]').textContent = `Settlement ${priceLabel(settlement)} /GPU-h`;
      readout.querySelector('[data-gpu-hedge-hedged]').textContent = `Hedged ${profit(values.hedged)}`;
      readout.querySelector('[data-gpu-hedge-unhedged]').textContent = `Unhedged ${profit(values.unhedged)}`;
      fitReadout(readout, chart.font);
      root.setAttribute('aria-valuenow', settlement.toFixed(4));
      root.setAttribute('aria-valuetext', description);
      cursor.setAttribute('x1', coordinate(chart.x(settlement)));
      cursor.setAttribute('x2', coordinate(chart.x(settlement)));
      if (showCursor) cursor.removeAttribute('visibility');
      else cursor.setAttribute('visibility', 'hidden');
    };
    const clear = () => {
      if (svg.ownerDocument?.activeElement === root) return;
      show(model.rate, false);
    };
    const inspect = event => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      if (local.y < chart.plot.top || local.y > chart.plot.bottom || local.x < 0 || local.x > WIDTH) { clear(); return; }
      show(chart.x.invert(local.x));
    };
    root.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return;
      touchGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    });
    root.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch') { inspect(event); return; }
      if (!touchGesture || event.pointerId !== touchGesture.id) return;
      if (Math.hypot(event.clientX - touchGesture.x, event.clientY - touchGesture.y) > 8) {
        touchGesture.moved = true;
        show(model.rate, false);
      }
    });
    root.addEventListener('pointerup', event => {
      if (!touchGesture || event.pointerId !== touchGesture.id) return;
      const tapped = !touchGesture.moved;
      touchGesture = null;
      if (tapped) inspect(event);
    });
    root.addEventListener('pointercancel', () => {
      touchGesture = null;
      show(model.rate, false);
    });
    root.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') clear(); });
    root.addEventListener('focus', () => show(settlement));
    root.addEventListener('blur', () => show(model.rate, false));
    root.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = (model.domain[1] - model.domain[0]) / 100;
      if (event.key === 'Escape') { show(model.rate, false); return; }
      show(event.key === 'Home' ? model.domain[0] : event.key === 'End' ? model.domain[1]
        : settlement + (['ArrowRight', 'ArrowUp'].includes(event.key) ? step : -step));
    });
    show(settlement, false);
    if (wasFocused) root.focus({ preventScroll: true });
  }
  if (canMorph) {
    animateGeometry(svg, displayed, update);
  } else if (motion === 'reveal' && !wasFocused) {
    // The fill and its edges reveal together; the area cannot flash ahead of
    // the two lines. Entrances never run for direct input or slider updates.
    root.querySelectorAll('[data-gpu-hedge-area], [data-gpu-hedge-line]')
      .forEach(node => animateChartDraw(node, { duration: 260 }));
    root.querySelectorAll('[data-gpu-hedge-label]')
      .forEach(node => animateChartSupport(node, { delay: 60, duration: 180 }));
  }
}

function geometryNodes(svg) {
  const nodes = new Map();
  svg.querySelectorAll('[data-gpu-hedge-line], [data-gpu-hedge-area], [data-gpu-hedge-zero], [data-gpu-hedge-label], [data-gpu-hedge-breakeven]')
    .forEach(node => {
      const attribute = [...node.attributes].find(attr => attr.name.startsWith('data-gpu-hedge-'));
      nodes.set(`${attribute.name}:${attribute.value}`, node);
    });
  svg.querySelectorAll('[data-gpu-hedge-axes] text').forEach(node => {
    const axis = node.hasAttribute('dominant-baseline') ? 'y' : 'x';
    nodes.set(`${axis}:${node.textContent}`, node);
    if (node.previousElementSibling?.tagName.toLowerCase() === 'line') {
      nodes.set(`grid:${axis}:${node.textContent}`, node.previousElementSibling);
    }
  });
  return nodes;
}

function captureGeometry(svg) {
  return new Map([...geometryNodes(svg)].map(([key, node]) => [key, {
    anchor: node.getAttribute('text-anchor'),
    attributes: Object.fromEntries(['d', 'x', 'y', 'x1', 'x2', 'y1', 'y2']
      .filter(name => node.hasAttribute(name)).map(name => [name, node.getAttribute(name)])),
  }]));
}

function animateGeometry(svg, previous, update) {
  const changes = [];
  for (const [key, node] of geometryNodes(svg)) {
    const before = previous.get(key);
    if (!before || before.anchor !== node.getAttribute('text-anchor')) continue;
    for (const [attribute, from] of Object.entries(before.attributes)) {
      const to = node.getAttribute(attribute);
      if (to === null || from === to) continue;
      changes.push({ node, attribute, to, interpolate: interpolateString(from, to) });
      node.setAttribute(attribute, from);
    }
  }
  if (!changes.length) return;
  const finish = () => {
    clock.stop();
    changes.forEach(({ node, attribute, to }) => node.setAttribute(attribute, to));
    update.cancel = update.finish = null;
  };
  const clock = timer(elapsed => {
    if (!svg.isConnected || elapsed >= 180) { finish(); return; }
    const progress = easeCubicOut(elapsed / 180);
    changes.forEach(({ node, attribute, interpolate }) => node.setAttribute(attribute, interpolate(progress)));
  });
  update.finish = finish;
  // Preserve the currently displayed frame for an interrupting render.
  update.cancel = () => { clock.stop(); update.cancel = update.finish = null; };
}

function markup(model, { colors = {}, compact = false, gallery = false, title, height = DEFAULT_HEIGHT, mobile = false } = {}) {
  const palette = Object.fromEntries(Object.entries({
    paper: '#fefefd', line: '#84908a', text: '#4e5e66', secondary: '#4e5e66', area: '#4e5e66', ...colors,
  }).map(([name, value]) => [name, esc(value)]));
  const font = mobile ? 36 : 24;
  const inset = 48;
  const plot = { top: gallery ? 192 : mobile ? 208 : 160, bottom: gallery ? height - 8 : height - 64 };
  const x = scaleLinear().domain(model.domain).range([0, WIDTH]).clamp(true);
  // Two samples suffice: both profit curves are exactly linear in settlement.
  const points = model.domain.map(settlement => ({ settlement, ...model.profitAt(settlement) }));
  const values = [0, ...points.flatMap(point => [point.unhedged, point.hedged])];
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.16, Math.abs(maximum) * 0.05, 1);
  const y = scaleLinear().domain([minimum - padding, maximum + padding]).range([plot.bottom, plot.top]);
  const path = key => line().x(point => x(point.settlement)).y(point => y(point[key]))(points);
  const spread = area().x(point => x(point.settlement)).y0(point => y(point.unhedged)).y1(point => y(point.hedged));
  const delivery = deliveryLabel(model.delivery);
  const safeTitle = !title || title === 'GPU hedge' ? `${model.gpu} hedge` : title;
  const context = String(safeTitle).includes(model.gpu) ? delivery : `${model.gpu}  ${delivery}`;
  const label = `${safeTitle}. ${delivery}. Buyer profit by settlement price in USD per GPU-hour. ${model.coverage}% hedged at ${dollar(model.rate)}. At entry: hedged profit ${profit(model.headlineProfit)}. Manual scenario.`;
  const baseline = gallery ? '' : `<line data-gpu-hedge-zero="" x1="0" x2="${WIDTH}" y1="${coordinate(y(0))}" y2="${coordinate(y(0))}" stroke="${palette.secondary}" stroke-opacity=".28" stroke-width="1" stroke-dasharray="3 7"/>`;
  const geometry = `<path data-gpu-hedge-area="" d="${spread(points)}" fill="${palette.area}" fill-opacity=".10"/>
    ${baseline}
    <path data-gpu-hedge-line="unhedged" d="${path('unhedged')}" fill="none" stroke="${palette.secondary}" stroke-opacity=".64" stroke-width="${gallery ? 3.5 : 3}"/>
    <path data-gpu-hedge-line="hedged" d="${path('hedged')}" fill="none" stroke="${palette.line}" stroke-width="${gallery ? 5 : 4}"/>`;
  const header = viewArtifactHeaderMarkup({
    title: safeTitle, context: context.toUpperCase(), headline: gallery ? profit(model.headlineProfit) : '', colors: palette, compact: gallery,
  }) + (gallery ? '' : `<g data-gpu-hedge-readout="" font-size="${font}" pointer-events="none">
    <text data-gpu-hedge-settlement="" data-readout-width="${mobile ? 1104 : 440}" x="${inset}" y="128" fill="${palette.line}">Settlement ${priceLabel(model.rate)} /GPU-h</text>
    <text data-gpu-hedge-hedged="" data-readout-width="${mobile ? 520 : 320}" x="${mobile ? inset : 528}" y="${mobile ? 176 : 128}" fill="${palette.line}">Hedged ${profit(model.headlineProfit)}</text>
    <text data-gpu-hedge-unhedged="" data-readout-width="${mobile ? 544 : 288}" x="${WIDTH-inset}" y="${mobile ? 176 : 128}" text-anchor="end" fill="${palette.secondary}" fill-opacity=".72">Unhedged ${profit(model.profitAt(model.rate).unhedged)}</text>
  </g>`);
  let annotations = '';
  if (!gallery) {
    const xTicks = spacedTicks(x, mobile ? 4 : 5, font, inset);
    const yTicks = y.ticks(4).filter(value => y(value) > plot.top + 24 && y(value) < plot.bottom - 8);
    annotations = `<g data-gpu-hedge-axes="" font-size="${font}" fill="${palette.secondary}">
      ${yTicks.map(value => `${value === 0 ? '' : `<line x1="0" x2="${WIDTH}" y1="${coordinate(y(value))}" y2="${coordinate(y(value))}" stroke="${palette.secondary}" stroke-opacity=".08" stroke-width="1"/>`}<text x="${inset}" y="${coordinate(y(value))}" dominant-baseline="middle" fill-opacity=".68" stroke="${palette.paper}" stroke-width="4" stroke-opacity=".86" style="paint-order:stroke fill">${profit(value)}</text>`).join('')}
      ${xTicks.map(value => `<text x="${coordinate(clamp(x(value), inset, WIDTH-inset))}" y="${height-24}" fill-opacity=".72" text-anchor="${x(value) < inset ? 'start' : x(value) > WIDTH-inset ? 'end' : 'middle'}">${priceLabel(value)}</text>`).join('')}
    </g>`;
    const labelSettlement = x.invert(WIDTH - 48);
    const labelProfits = model.profitAt(labelSettlement);
    let hedgedY = y(labelProfits.hedged) - 16;
    let unhedgedY = y(labelProfits.unhedged) - 16;
    if (Math.abs(hedgedY - unhedgedY) < 40) {
      hedgedY = y(labelProfits.hedged) - 20;
      unhedgedY = y(labelProfits.unhedged) + 32;
    }
    // Keep a nearby breakeven annotation to the left of the direct series
    // labels when their vertical positions coincide in large-scale scenarios.
    const breakEvenAnchor = x(model.breakEven) > WIDTH*.72 ? 'end' : 'start';
    let breakEvenX = clamp(x(model.breakEven)+12, inset, WIDTH-inset);
    const breakEvenY = y(0)-16;
    if (breakEvenAnchor === 'end' && [hedgedY, unhedgedY].some(labelY => Math.abs(labelY-breakEvenY) < font+12)) {
      breakEvenX = Math.min(breakEvenX, WIDTH-48-'Unhedged'.length*font*.62-28);
    }
    annotations += `<g font-size="${font}" stroke="${palette.paper}" stroke-width="6" stroke-opacity=".86" stroke-linejoin="round" style="paint-order:stroke fill" pointer-events="none">
      <text data-gpu-hedge-label="hedged" x="${WIDTH-48}" y="${coordinate(clamp(hedgedY, plot.top+font, plot.bottom))}" text-anchor="end" fill="${palette.line}">Hedged</text>
      <text data-gpu-hedge-label="unhedged" x="${WIDTH-48}" y="${coordinate(clamp(unhedgedY, plot.top+font, plot.bottom))}" text-anchor="end" fill="${palette.secondary}" fill-opacity=".72">Unhedged</text>
      ${model.breakEven !== null && model.breakEven >= model.domain[0] && model.breakEven <= model.domain[1]
        ? `<text data-gpu-hedge-breakeven="" x="${coordinate(breakEvenX)}" y="${coordinate(breakEvenY)}" text-anchor="${breakEvenAnchor}" fill="${palette.secondary}" fill-opacity=".72" font-size="${font}">Breakeven ${priceLabel(model.breakEven)}</text>` : ''}
    </g>
    <line data-gpu-hedge-cursor="" visibility="hidden" y1="${plot.top}" y2="${plot.bottom}" stroke="${palette.secondary}" stroke-opacity=".28" stroke-width="1" pointer-events="none"/>`;
  }
  return { height, x, plot, label, mobile, font, inset, inner: `<rect width="${WIDTH}" height="${height}" fill="${palette.paper}"/>
    <g data-gpu-hedge-chart="" font-family="Geist Mono, monospace" font-weight="500" style="font-variant-numeric:tabular-nums">
      <rect x="0" y="${plot.top}" width="${WIDTH}" height="${plot.bottom-plot.top}" fill="transparent"/>
      ${geometry}${annotations}${header}
    </g>` };
}

function readoutText(model, settlement) {
  const values = model.profitAt(settlement);
  return `Settlement ${priceLabel(settlement)} /GPU-h   Hedged profit ${profit(values.hedged)}   Unhedged profit ${profit(values.unhedged)}`;
}

function fitReadout(readout, font) {
  readout.querySelectorAll('text').forEach(node => {
    node.setAttribute('font-size', font);
    const width = Number(node.dataset.readoutWidth);
    const measured = node.getComputedTextLength?.() || node.textContent.length * font * .62;
    if (measured > width) node.setAttribute('font-size', font * width / measured);
  });
}

function spacedTicks(scale, count, font, inset) {
  const ticks = scale.ticks(count);
  const bounds = value => {
    const width = priceLabel(value).length * font * .62;
    const position = clamp(scale(value), inset, WIDTH-inset);
    const left = scale(value) < inset ? position : scale(value) > WIDTH-inset ? position-width : position-width/2;
    return [left, left+width];
  };
  const selected = [];
  for (const value of ticks) {
    if (selected.length && bounds(value)[0] < bounds(selected.at(-1))[1]+24) {
      if (value !== ticks.at(-1)) continue;
      selected.pop();
    }
    selected.push(value);
  }
  return selected;
}

function deliveryLabel(delivery) {
  const [year, month] = delivery.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month-1]} ${year}`;
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
