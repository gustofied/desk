import { gsap } from 'gsap';
import { cancelChartMotion } from './chart-motion.js';
import { viewArtifactHeaderMarkup } from './view-artifact-header.js';

const WIDTH = 1200;
const DEFAULT_HEIGHT = 675;
const charts = new WeakMap();
const hoursFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function renderGpuCoverageSvg(model, options = {}) {
  const chart = describe(model, options);
  const accessibility = options.decorative ? 'aria-hidden="true"'
    : `role="img" aria-label="${escapeXml(chart.label)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${chart.height}" viewBox="0 0 ${WIDTH} ${chart.height}" ${accessibility}>${markup(chart)}</svg>`;
}

export function cancelGpuCoverageMotion(svg) {
  const state = charts.get(svg);
  state?.fillTween?.kill();
  state?.entrance?.kill();
  if (state) {
    state.releaseHover?.();
    state.releaseHover = null;
    state.fillTween = state.entrance = null;
    gsap.set(state.cells, { clearProps: 'transform,opacity' });
    if (state.root !== svg.querySelector('[data-gpu-coverage-chart]')) charts.delete(svg);
  }
  cancelChartMotion(svg);
}

export function paintGpuCoverageChart(svg, model, options = {}) {
  if (!svg) return;
  let state = charts.get(svg);
  cancelGpuCoverageMotion(svg);
  const height = options.compact ? DEFAULT_HEIGHT : svg.clientWidth > 0 && svg.clientHeight > 0
    ? Math.max(480, WIDTH * svg.clientHeight / svg.clientWidth) : DEFAULT_HEIGHT;
  const chart = describe(model, { ...options, height, mobile: svg.clientWidth > 0 && svg.clientWidth < 640 });
  const existing = svg.querySelector('[data-gpu-coverage-chart]');
  const initial = !state || state.root !== existing;
  if (initial) {
    svg.innerHTML = markup(chart);
    const root = svg.querySelector('[data-gpu-coverage-chart]');
    state = {
      root,
      tiles: [...root.querySelectorAll('[data-gpu-coverage-tile]')],
      cells: [...root.querySelectorAll('[data-gpu-coverage-cell]')],
      fills: [...root.querySelectorAll('[data-gpu-coverage-fill]')],
      fractions: chart.fractions.slice(),
      fillTween: null, entrance: null,
    };
    // Hover has its own transform, independent of the entrance and data fill.
    // Keep these wrappers out of exported SVGs and share images.
    state.hoverCells = state.cells.map(cell => {
      const hover = svg.ownerDocument.createElementNS(svg.namespaceURI, 'g');
      hover.setAttribute('data-gpu-coverage-hover', '');
      hover.append(...cell.children);
      cell.append(hover);
      return hover;
    });
    charts.set(svg, state);
  } else syncArtwork(state, chart);

  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${chart.height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', chart.label);
  if (options.decorative) svg.setAttribute('aria-hidden', 'true');
  else svg.removeAttribute('aria-hidden');

  const reduced = options.reducedMotion || (options.decorative && !options.previewMotion)
    || svg.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const motion = reduced ? 'none' : options.motion ?? (initial ? 'reveal' : 'update');
  if (!initial && motion === 'update') animateFills(svg, state, chart.fractions);
  else chart.fractions.forEach((fraction, index) => setFraction(state, index, fraction));

  if (motion === 'reveal' || (initial && motion === 'update')) {
    // One cancellable wave; no perpetual motion or per-cell timers.
    state.entrance = gsap.timeline({
      onComplete: () => { state.entrance = null; gsap.set(state.cells, { clearProps: 'transform,opacity' }); },
    }).fromTo(state.cells,
      { opacity: 0, scaleX: .94, scaleY: .9, y: 12, transformOrigin: '50% 50%' },
      { opacity: 1, scaleX: 1, scaleY: 1, y: 0, duration: .36, ease: 'back.out(3)',
        stagger: { grid: [gridRows(chart), chart.grid.columns], from: 'start', amount: .12 }, overwrite: true });
  }
  if (options.hoverMotion ?? !reduced) state.releaseHover = bindTileHover(svg, state, chart);
}

function bindTileHover(svg, state, { grid }) {
  const win = svg.ownerDocument.defaultView;
  // Previews remain one clickable card. Their artwork deliberately ignores
  // pointer events, so listen on the button without changing click behaviour.
  const target = svg.closest('button') || svg;
  const finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let point = null;
  let affected = new Set();
  const controls = new Map();
  const pitchX = grid.cellWidth + grid.gap;
  const pitchY = grid.cellHeight + grid.gap;
  const swellX = Math.min(.16, grid.gap * .75 / grid.cellWidth);
  const swellY = Math.min(.07, grid.gap * .55 / grid.cellHeight);

  function draw(index, value) {
    const cell = state.hoverCells[index];
    if (Math.abs(value) < .0001) { cell.removeAttribute('transform'); return; }
    const pressure = clamp(value, -.16, 1);
    const cx = grid.cellWidth / 2;
    const cy = grid.cellHeight / 2;
    // One transform write; no per-tile layout reads while following the mouse.
    cell.setAttribute('transform', `translate(${cx} ${cy - 4 * pressure}) scale(${1 + swellX * pressure} ${1 + swellY * pressure}) translate(${-cx} ${-cy})`);
  }

  function follow(index, weight) {
    let control = controls.get(index);
    if (!control) {
      control = { value: 0, target: 0, release: null };
      control.follow = gsap.quickTo(control, 'value', { duration: .18, ease: 'power3.out',
        onUpdate: () => draw(index, control.value) });
      controls.set(index, control);
    }
    if (!control.release && Math.abs(control.target - weight) < .001) return;
    control.release?.kill();
    control.release = null;
    control.target = weight;
    // An interrupted return may have moved past the follower's cached value.
    control.follow(weight, control.value);
  }

  function settle(index) {
    const control = controls.get(index);
    if (!control) return;
    control.follow.tween.pause();
    control.release?.kill();
    control.target = 0;
    control.release = gsap.to(control, { value: 0, duration: .42, ease: 'elastic.out(1,.45)',
      onUpdate: () => draw(index, control.value),
      onComplete: () => { control.release = null; draw(index, 0); } });
  }

  function reset(immediate = false) {
    win.cancelAnimationFrame(frame);
    frame = 0;
    point = null;
    if (immediate) {
      controls.forEach((control, index) => {
        control.follow.tween.pause();
        control.release?.kill();
        control.release = null;
        control.value = control.target = 0;
        draw(index, 0);
      });
    } else affected.forEach(index => settle(index));
    affected.clear();
  }

  function update() {
    frame = 0;
    if (!point || !svg.isConnected || state.root !== svg.querySelector('[data-gpu-coverage-chart]')) return reset(true);
    if (!finePointer.matches || reduce.matches) return reset(true);
    const matrix = svg.getScreenCTM();
    if (!matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-9) return reset(true);
    const local = svg.createSVGPoint();
    local.x = point.x; local.y = point.y;
    const { x, y } = local.matrixTransform(matrix.inverse());
    if (x < grid.x || x > grid.x + grid.width || y < grid.y || y > grid.y + grid.height) return reset();
    const column = (x - grid.x - grid.cellWidth / 2) / pitchX;
    const row = (y - grid.y - grid.cellHeight / 2) / pitchY;
    const next = new Set();
    for (let r = Math.max(0, Math.ceil(row - 2)); r <= Math.min(100 / grid.columns - 1, Math.floor(row + 2)); r++) {
      for (let c = Math.max(0, Math.ceil(column - 2)); c <= Math.min(grid.columns - 1, Math.floor(column + 2)); c++) {
        const distance = Math.hypot(c - column, r - row);
        const influence = Math.max(0, 1 - distance / 1.8);
        const weight = influence * influence * (3 - 2 * influence);
        if (weight < .001) continue;
        const tile = r * grid.columns + c;
        next.add(tile);
        follow(tile, weight);
      }
    }
    affected.forEach(tile => { if (!next.has(tile)) settle(tile); });
    affected = next;
  }

  function move(event) {
    if (event.pointerType === 'touch' || event.buttons || !finePointer.matches || reduce.matches) return reset(true);
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = win.requestAnimationFrame(update);
  }
  const leave = () => reset();
  const stop = () => reset(true);
  const preferenceChanged = () => { if (reduce.matches || !finePointer.matches) stop(); };
  finePointer.addEventListener('change', preferenceChanged);
  reduce.addEventListener('change', preferenceChanged);
  target.addEventListener('pointermove', move, { passive: true });
  target.addEventListener('pointerleave', leave);
  target.addEventListener('pointercancel', stop);
  target.addEventListener('pointerdown', stop);
  target.addEventListener('keydown', stop);
  target.addEventListener('blur', stop);
  return () => {
    reset(true);
    controls.forEach(control => control.follow.tween.kill());
    controls.clear();
    finePointer.removeEventListener('change', preferenceChanged);
    reduce.removeEventListener('change', preferenceChanged);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerleave', leave);
    target.removeEventListener('pointercancel', stop);
    target.removeEventListener('pointerdown', stop);
    target.removeEventListener('keydown', stop);
    target.removeEventListener('blur', stop);
  };
}

function describe(model, { colors = {}, gallery = false, title, height = DEFAULT_HEIGHT, mobile = false } = {}) {
  const coverage = clamp(finite(model?.coverage, 0), 0, 100);
  const hours = Math.max(0, finite(model?.hours, 0));
  const hedgedHours = Math.max(0, finite(model?.hedgedHours, hours * coverage / 100));
  const exposedHours = Math.max(0, finite(model?.exposedHours, hours - hedgedHours));
  const gpu = String(model?.gpu || 'H100');
  const delivery = /^\d{4}-(0[1-9]|1[0-2])$/.test(model?.delivery) ? model.delivery : '2026-10';
  const [year, month] = delivery.split('-').map(Number);
  const date = `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month - 1]} ${year}`;
  const safeTitle = !title || title === 'GPU coverage' || title === 'GPU hedge' ? `${gpu} coverage` : String(title);
  const palette = { paper: '#fefefd', line: '#84908a', secondary: '#4e5e66', area: '#4e5e66', ...colors };
  const safeHeight = Math.max(480, finite(height, DEFAULT_HEIGHT));
  // A very short mobile embed needs the horizontal layout: reserving stacked
  // readout space there would collapse a hundred tiles to a miniature grid.
  const narrow = mobile && !gallery && safeHeight >= 800;
  const inset = narrow ? 48 : 24;
  const grid = {
    x: inset,
    y: gallery ? 240 : narrow ? 256 : 224,
    width: WIDTH - inset * 2,
    height: narrow ? safeHeight - 480 : safeHeight - (gallery ? 264 : 248),
    columns: narrow ? 10 : 20,
    gap: narrow ? 12 : 8,
  };
  grid.cellWidth = (grid.width - grid.gap * (grid.columns - 1)) / grid.columns;
  grid.cellHeight = (grid.height - grid.gap * (100 / grid.columns - 1)) / (100 / grid.columns);
  grid.radius = Math.min(grid.cellWidth, grid.cellHeight) * .32;
  return {
    coverage, hours, hedgedHours, exposedHours, gpu, gallery, mobile: narrow,
    title: safeTitle, context: safeTitle.includes(gpu) ? date : `${gpu}  ${date}`,
    height: safeHeight, palette, grid,
    fractions: Array.from({ length: 100 }, (_, index) => clamp(coverage - index, 0, 1)),
    label: `${gpu} GPU coverage, ${date}. ${coverage}% hedged. ${hoursFormat.format(hedgedHours)} hedged and ${hoursFormat.format(exposedHours)} exposed GPU-hours, of ${hoursFormat.format(hours)} total. Each tile represents one percentage point; partial tiles show fractional coverage.`,
  };
}

function markup(chart) {
  return `<g data-gpu-coverage-chart="" font-family="Geist Mono, monospace" font-weight="500" style="font-variant-numeric:tabular-nums">
    <rect data-gpu-coverage-paper="" width="${WIDTH}" height="${chart.height}" fill="${escapeXml(chart.palette.paper)}"/>
    <g data-gpu-coverage-grid="" aria-hidden="true">${chart.fractions.map((fraction, index) => tileMarkup(chart, index, fraction)).join('')}</g>
    <g data-gpu-coverage-readouts="">${readoutMarkup(chart)}</g>
    <g data-gpu-coverage-header="">${headerMarkup(chart)}</g>
  </g>`;
}

function tileMarkup({ grid, palette }, index, fraction) {
  const x = grid.x + (index % grid.columns) * (grid.cellWidth + grid.gap);
  const y = grid.y + Math.floor(index / grid.columns) * (grid.cellHeight + grid.gap);
  return `<g data-gpu-coverage-tile="${index}" transform="translate(${coordinate(x)} ${coordinate(y)})">
    <g data-gpu-coverage-cell="" style="transform-box:fill-box;transform-origin:center">
      <rect data-gpu-coverage-base="" width="${coordinate(grid.cellWidth)}" height="${coordinate(grid.cellHeight)}" rx="${coordinate(grid.radius)}" fill="${escapeXml(palette.secondary)}" fill-opacity=".12"/>
      <g data-gpu-coverage-fill="" data-gpu-coverage-fraction="${fraction}" transform="scale(${fraction} 1)">
        <rect width="${coordinate(grid.cellWidth)}" height="${coordinate(grid.cellHeight)}" rx="${coordinate(grid.radius)}" fill="${escapeXml(palette.line)}" fill-opacity=".92"/>
      </g>
    </g>
  </g>`;
}

function headerMarkup(chart) {
  return viewArtifactHeaderMarkup({
    title: chart.title, context: chart.context, headline: `${chart.coverage}%`,
    colors: Object.fromEntries(Object.entries(chart.palette).map(([key, value]) => [key, escapeXml(value)])),
    compact: chart.gallery || chart.mobile,
  });
}

function readoutMarkup(chart) {
  if (chart.gallery) return '';
  const { grid, palette, mobile, height } = chart;
  const nominal = mobile ? 72 : 48;
  const labelSize = mobile ? 32 : 24;
  const width = mobile ? 516 : 288;
  const rows = [
    { key: 'hedged', label: 'Hedged', value: chart.hedgedHours, color: palette.line },
    { key: 'exposed', label: 'Exposed', value: chart.exposedHours, color: palette.secondary },
  ];
  return rows.map((row, index) => {
    const text = hoursFormat.format(row.value);
    const amountSize = Math.min(nominal, width / Math.max(1, text.length * .59));
    const x = mobile ? index ? 636 : 48 : index ? 864 : 528;
    const labelY = mobile ? grid.y + grid.height + 56 : 108;
    const valueY = mobile ? grid.y + grid.height + 128 : 160;
    return `<text data-gpu-coverage-${row.key}-label="" x="${x}" y="${coordinate(labelY)}" fill="${escapeXml(row.color)}" fill-opacity=".68" font-size="${coordinate(labelSize)}">${row.label}</text>
      <text data-gpu-coverage-${row.key}-hours="" x="${x}" y="${coordinate(valueY)}" fill="${escapeXml(row.color)}" font-family="Geist, Avenir Next, sans-serif" font-size="${coordinate(amountSize)}" font-weight="500" letter-spacing="-1">${text}</text>`;
  }).join('') + `<text x="${mobile ? 48 : 1152}" y="${mobile ? height - 24 : 200}" text-anchor="${mobile ? 'start' : 'end'}" fill="${escapeXml(palette.secondary)}" fill-opacity=".60" font-size="${mobile ? 28 : 20}">GPU-hours</text>`;
}

function syncArtwork(state, chart) {
  const { grid, palette } = chart;
  const paper = state.root.querySelector('[data-gpu-coverage-paper]');
  paper.setAttribute('height', chart.height);
  paper.setAttribute('fill', palette.paper);
  state.root.querySelector('[data-gpu-coverage-header]').innerHTML = headerMarkup(chart);
  state.root.querySelector('[data-gpu-coverage-readouts]').innerHTML = readoutMarkup(chart);
  state.tiles.forEach((tile, index) => {
    const x = grid.x + index % grid.columns * (grid.cellWidth + grid.gap);
    const y = grid.y + Math.floor(index / grid.columns) * (grid.cellHeight + grid.gap);
    tile.setAttribute('transform', `translate(${coordinate(x)} ${coordinate(y)})`);
    tile.querySelectorAll('rect').forEach(rect => {
      rect.setAttribute('width', coordinate(grid.cellWidth));
      rect.setAttribute('height', coordinate(grid.cellHeight));
      rect.setAttribute('rx', coordinate(grid.radius));
      rect.setAttribute('fill', rect.hasAttribute('data-gpu-coverage-base') ? palette.secondary : palette.line);
    });
  });
}

function setFraction(state, index, fraction) {
  state.fractions[index] = fraction;
  state.fills[index].setAttribute('transform', `scale(${fraction} 1)`);
  state.fills[index].setAttribute('data-gpu-coverage-fraction', fraction);
}

function animateFills(svg, state, target) {
  const changed = target.map((value, index) => index).filter(index => state.fractions[index] !== target[index]);
  if (!changed.length) return;
  const from = state.fractions.slice();
  const position = { progress: 0 };
  state.fillTween = gsap.to(position, { progress: 1, duration: .22, ease: 'power3.out',
    onUpdate: () => {
      if (!svg.isConnected || state.root !== svg.querySelector('[data-gpu-coverage-chart]')) {
        cancelGpuCoverageMotion(svg);
        return;
      }
      changed.forEach(index => setFraction(state, index, from[index] + (target[index] - from[index]) * position.progress));
    },
    onComplete: () => { changed.forEach(index => setFraction(state, index, target[index])); state.fillTween = null; },
  });
}

function gridRows(chart) { return 100 / chart.grid.columns; }

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function coordinate(value) { return Number(value.toFixed(3)); }
function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
