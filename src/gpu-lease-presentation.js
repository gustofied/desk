import { gsap } from 'gsap';
import { cancelChartMotion } from './chart-motion.js';
import { viewArtifactHeaderMarkup } from './view-artifact-header.js';

const WIDTH = 1200;
const DEFAULT_HEIGHT = 675;
const TILE_COUNT = 48;
const charts = new WeakMap();
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function renderGpuLeaseSvg(model, options = {}) {
  const chart = describe(model, options);
  const accessibility = options.decorative ? 'aria-hidden="true"'
    : `role="img" aria-label="${escapeXml(chart.label)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${chart.height}" viewBox="0 0 ${WIDTH} ${chart.height}" ${accessibility}>${markup(chart)}</svg>`;
}

export function cancelGpuLeaseMotion(svg) {
  const state = charts.get(svg);
  state?.fillTween?.kill();
  state?.entrance?.kill();
  if (state) {
    state.releaseHover?.();
    state.releaseHover = null;
    state.fillTween = state.entrance = null;
    gsap.set(state.cells, { clearProps: 'transform,opacity' });
    if (state.root !== svg.querySelector('[data-gpu-lease-chart]')) charts.delete(svg);
  }
  cancelChartMotion(svg);
}

export function paintGpuLeaseChart(svg, model, options = {}) {
  if (!svg) return;
  let state = charts.get(svg);
  cancelGpuLeaseMotion(svg);
  const height = options.compact ? DEFAULT_HEIGHT : svg.clientWidth > 0 && svg.clientHeight > 0
    ? Math.max(480, WIDTH * svg.clientHeight / svg.clientWidth) : DEFAULT_HEIGHT;
  const chart = describe(model, { ...options, height, mobile: svg.clientWidth > 0 && svg.clientWidth < 640 });
  const existing = svg.querySelector('[data-gpu-lease-chart]');
  const initial = !state || state.root !== existing;
  if (initial) {
    svg.innerHTML = markup(chart);
    const root = svg.querySelector('[data-gpu-lease-chart]');
    state = {
      root,
      tiles: [...root.querySelectorAll('[data-gpu-lease-tile]')],
      cells: [...root.querySelectorAll('[data-gpu-lease-cell]')],
      fills: [...root.querySelectorAll('[data-gpu-lease-fill]')],
      fractions: chart.fractions.slice(),
      size: chart.grid.size,
      fillTween: null,
      entrance: null,
    };
    // Keep interaction transforms separate from entrance motion and data fills.
    state.hoverCells = state.cells.map(cell => {
      const hover = svg.ownerDocument.createElementNS(svg.namespaceURI, 'g');
      hover.setAttribute('data-gpu-lease-hover', '');
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
    state.entrance = gsap.timeline({
      onComplete: () => { state.entrance = null; gsap.set(state.cells, { clearProps: 'transform,opacity' }); },
    }).fromTo(state.cells,
      { opacity: 0, scale: .94, y: 8, transformOrigin: '50% 50%' },
      { opacity: 1, scale: 1, y: 0, duration: .36, ease: 'back.out(2)',
        stagger: { grid: [chart.grid.rows, chart.grid.columns], from: 'start', amount: .12 }, overwrite: true });
  }
  // Compact cards suppress entrances separately from pointer feedback. The
  // hover binding still honors the user's actual reduced-motion preference.
  if (options.hoverMotion ?? !reduced) state.releaseHover = bindTileHover(svg, state, chart);
}

function describe(model, { colors = {}, gallery = false, title, height = DEFAULT_HEIGHT, mobile = false } = {}) {
  const term = Math.max(1, Math.round(finite(model?.term, 36)));
  const residual = Math.max(0, finite(model?.residual, 0));
  const monthlyPayment = Math.max(0, finite(model?.monthlyPayment, 0));
  const totalPayments = Math.max(0, finite(model?.totalPayments, monthlyPayment * term));
  const totalReceipts = totalPayments + residual;
  const residualShare = totalReceipts > 0 ? residual / totalReceipts : 0;
  const palette = { paper: '#fefefd', line: '#84908a', secondary: '#4e5e66', area: '#4e5e66', ...colors };
  const safeHeight = Math.max(480, finite(height, DEFAULT_HEIGHT));
  const stacked = !gallery && mobile && safeHeight >= 800;
  const columns = gallery ? 12 : 8;
  const rows = TILE_COUNT / columns;
  const gap = gallery ? 12 : 16;
  const top = gallery ? 240 : stacked ? 256 : 216;
  const availableWidth = gallery ? 1152 : stacked ? 1104 : 640;
  const availableHeight = Math.max(144, safeHeight - top - (gallery ? 56 : stacked ? 240 : 32));
  const size = Math.min((availableWidth - gap * (columns - 1)) / columns,
    (availableHeight - gap * (rows - 1)) / rows);
  const width = size * columns + gap * (columns - 1);
  const gridHeight = size * rows + gap * (rows - 1);
  const grid = {
    x: gallery || stacked ? (WIDTH - width) / 2 : 48,
    y: top + (availableHeight - gridHeight) / 2,
    width, height: gridHeight, size, columns, rows, gap,
    radius: size * .24,
  };
  const filled = residualShare * TILE_COUNT;
  // The rightmost columns hold resale proceeds, matching the reference. Both
  // components use total nominal receipts as their denominator, not asset cost.
  const fractions = Array.from({ length: TILE_COUNT }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return clamp(filled - ((columns - column - 1) * rows + row), 0, 1);
  });
  return {
    term, residual, monthlyPayment, totalPayments, residualShare,
    title: String(title || 'Residual value'), context: `${term} MONTHS`,
    height: safeHeight, gallery, mobile: stacked, palette, grid, fractions,
    label: `Residual value. ${term} monthly lease payments of ${dollars(monthlyPayment)}, totaling ${dollars(totalPayments)}, plus ${dollars(residual)} resale value at exit. The squares show ${money.format((1 - residualShare) * 100)}% lease payments and ${money.format(residualShare * 100)}% resale value as shares of total nominal receipts.`,
  };
}

function markup(chart) {
  return `<g data-gpu-lease-chart="" font-family="Geist Mono, monospace" font-weight="500" style="font-variant-numeric:tabular-nums">
    <rect data-gpu-lease-paper="" width="${WIDTH}" height="${chart.height}" fill="${escapeXml(chart.palette.paper)}"/>
    <g data-gpu-lease-grid="" aria-hidden="true">${chart.fractions.map((fraction, index) => tileMarkup(chart, index, fraction)).join('')}</g>
    <g data-gpu-lease-readouts="">${readoutMarkup(chart)}</g>
    <g data-gpu-lease-header="">${headerMarkup(chart)}</g>
  </g>`;
}

function tileMarkup({ grid, palette }, index, fraction) {
  const { x, y } = tilePosition(grid, index);
  const inset = grid.size * (1 - fraction);
  return `<g data-gpu-lease-tile="${index}" transform="translate(${coordinate(x)} ${coordinate(y)})">
    <g data-gpu-lease-cell="" style="transform-box:fill-box;transform-origin:center">
      <rect data-gpu-lease-base="" width="${coordinate(grid.size)}" height="${coordinate(grid.size)}" rx="${coordinate(grid.radius)}" fill="${escapeXml(palette.secondary)}" fill-opacity=".22"/>
      <svg data-gpu-lease-fill="" data-gpu-lease-fraction="${fraction}" x="${coordinate(inset)}" y="0" width="${coordinate(grid.size * fraction)}" height="${coordinate(grid.size)}" overflow="hidden">
        <rect x="${coordinate(-inset)}" width="${coordinate(grid.size)}" height="${coordinate(grid.size)}" rx="${coordinate(grid.radius)}" fill="${escapeXml(palette.line)}" fill-opacity=".94"/>
      </svg>
    </g>
  </g>`;
}

function headerMarkup(chart) {
  return viewArtifactHeaderMarkup({
    title: chart.title, context: chart.context, headline: dollars(chart.residual),
    colors: Object.fromEntries(Object.entries(chart.palette).map(([key, value]) => [key, escapeXml(value)])),
    compact: chart.gallery || chart.mobile,
  });
}

function readoutMarkup(chart) {
  const { grid, palette, gallery, mobile, term, monthlyPayment, residual } = chart;
  if (gallery) {
    return `<text x="48" y="${coordinate(chart.height - 20)}" fill="${escapeXml(palette.secondary)}" fill-opacity=".72" font-size="28">Lease payments</text>
      <text x="1152" y="${coordinate(chart.height - 20)}" text-anchor="end" fill="${escapeXml(palette.line)}" fill-opacity=".86" font-size="28">Resale value</text>`;
  }
  const rows = [
    { label: 'Lease payments', value: `${term} × ${dollars(monthlyPayment)}`, color: palette.secondary },
    { label: 'Resale value', value: `${dollars(residual)} at exit`, color: palette.line },
  ];
  return rows.map((row, index) => {
    const x = mobile ? index ? 648 : 48 : 768;
    const y = mobile ? grid.y + grid.height + 80 : grid.y + grid.height * (index ? .66 : .24);
    const labelSize = mobile ? 36 : 30;
    const valueSize = Math.min(48, (mobile ? 504 : 384) / (row.value.length * .57));
    return `<text x="${x}" y="${coordinate(y)}" fill="${escapeXml(row.color)}" fill-opacity=".70" font-size="${labelSize}">${row.label}</text>
      <text x="${x}" y="${coordinate(y + 64)}" fill="${escapeXml(row.color)}" font-family="Geist, Avenir Next, sans-serif" font-size="${coordinate(valueSize)}" font-weight="500" letter-spacing="-1">${escapeXml(row.value)}</text>`;
  }).join('');
}

function syncArtwork(state, chart) {
  const { grid, palette } = chart;
  state.size = grid.size;
  const paper = state.root.querySelector('[data-gpu-lease-paper]');
  paper.setAttribute('height', chart.height);
  paper.setAttribute('fill', palette.paper);
  state.root.querySelector('[data-gpu-lease-header]').innerHTML = headerMarkup(chart);
  state.root.querySelector('[data-gpu-lease-readouts]').innerHTML = readoutMarkup(chart);
  state.tiles.forEach((tile, index) => {
    const { x, y } = tilePosition(grid, index);
    tile.setAttribute('transform', `translate(${coordinate(x)} ${coordinate(y)})`);
    tile.querySelectorAll('rect').forEach(rect => {
      rect.setAttribute('width', coordinate(grid.size));
      rect.setAttribute('height', coordinate(grid.size));
      rect.setAttribute('rx', coordinate(grid.radius));
      rect.setAttribute('fill', rect.hasAttribute('data-gpu-lease-base') ? palette.secondary : palette.line);
    });
    state.fills[index].setAttribute('height', coordinate(grid.size));
    setFraction(state, index, state.fractions[index]);
  });
}

function setFraction(state, index, fraction) {
  const safeFraction = clamp(fraction, 0, 1);
  const inset = state.size * (1 - safeFraction);
  state.fractions[index] = safeFraction;
  const fill = state.fills[index];
  // Crop the same rounded square; never squeeze it into a narrow pill.
  fill.setAttribute('x', coordinate(inset));
  fill.setAttribute('width', coordinate(state.size * safeFraction));
  fill.setAttribute('data-gpu-lease-fraction', safeFraction);
  fill.firstElementChild.setAttribute('x', coordinate(-inset));
}

function animateFills(svg, state, target) {
  const changed = target.map((value, index) => index).filter(index => state.fractions[index] !== target[index]);
  if (!changed.length) return;
  const from = state.fractions.slice();
  const position = { progress: 0 };
  state.fillTween = gsap.to(position, { progress: 1, duration: .22, ease: 'power3.out',
    onUpdate: () => {
      if (!svg.isConnected || state.root !== svg.querySelector('[data-gpu-lease-chart]')) {
        cancelGpuLeaseMotion(svg);
        return;
      }
      changed.forEach(index => setFraction(state, index, from[index] + (target[index] - from[index]) * position.progress));
    },
    onComplete: () => { changed.forEach(index => setFraction(state, index, target[index])); state.fillTween = null; },
  });
}

function bindTileHover(svg, state, { grid }) {
  const win = svg.ownerDocument.defaultView;
  const target = svg.closest('button') || svg;
  const finePointer = win.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let point = null;
  let affected = new Set();
  const controls = new Map();
  const pitch = grid.size + grid.gap;
  const swell = Math.min(.12, grid.gap * .7 / grid.size);

  function draw(index, value) {
    const cell = state.hoverCells[index];
    if (Math.abs(value) < .0001) { cell.removeAttribute('transform'); return; }
    const pressure = clamp(value, -.16, 1);
    const center = grid.size / 2;
    const scale = 1 + swell * pressure;
    cell.setAttribute('transform', `translate(${center} ${center - 3 * pressure}) scale(${scale}) translate(${-center} ${-center})`);
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
    if (!point || !svg.isConnected || state.root !== svg.querySelector('[data-gpu-lease-chart]')) return reset(true);
    if (!finePointer.matches || reduce.matches) return reset(true);
    const matrix = svg.getScreenCTM();
    if (!matrix || Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-9) return reset(true);
    const local = svg.createSVGPoint();
    local.x = point.x; local.y = point.y;
    const { x, y } = local.matrixTransform(matrix.inverse());
    if (x < grid.x || x > grid.x + grid.width || y < grid.y || y > grid.y + grid.height) return reset();
    const column = (x - grid.x - grid.size / 2) / pitch;
    const row = (y - grid.y - grid.size / 2) / pitch;
    const next = new Set();
    for (let r = Math.max(0, Math.ceil(row - 2)); r <= Math.min(grid.rows - 1, Math.floor(row + 2)); r++) {
      for (let c = Math.max(0, Math.ceil(column - 2)); c <= Math.min(grid.columns - 1, Math.floor(column + 2)); c++) {
        const influence = Math.max(0, 1 - Math.hypot(c - column, r - row) / 1.8);
        const weight = influence * influence * (3 - 2 * influence);
        if (weight < .001) continue;
        const index = r * grid.columns + c;
        next.add(index);
        follow(index, weight);
      }
    }
    affected.forEach(index => { if (!next.has(index)) settle(index); });
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

function tilePosition(grid, index) {
  return { x: grid.x + index % grid.columns * (grid.size + grid.gap),
    y: grid.y + Math.floor(index / grid.columns) * (grid.size + grid.gap) };
}
function dollars(value) {
  const magnitude = Math.abs(value);
  const [divisor, suffix] = magnitude >= 1e9 ? [1e9, 'b'] : magnitude >= 1e6 ? [1e6, 'm'] : magnitude >= 1e3 ? [1e3, 'k'] : [1, ''];
  return `$${money.format(value / divisor)}${suffix}`;
}
function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function coordinate(value) { return Number(value.toFixed(3)); }
function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
