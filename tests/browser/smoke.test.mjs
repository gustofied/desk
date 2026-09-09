import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CARD_REGISTRY } from '../../src/card-registry.js';
import { createSharedDesk, encodeSharedDesk } from '../../src/shared-desk.js';

const moduleName = process.env.DESK_PLAYWRIGHT_MODULE || 'playwright';
const playwright = await import(isAbsolute(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const origin = process.env.DESK_BASE_URL || 'http://127.0.0.1:4173';
let browser;
before(async () => {
  browser = await playwright[process.env.DESK_BROWSER_ENGINE || 'chromium'].launch({
    headless: true, ...(process.env.DESK_BROWSER_PATH ? { executablePath: process.env.DESK_BROWSER_PATH } : {}),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
});
after(async () => { await browser?.close(); });

async function pageFor(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'uncaught browser errors'); });
  return page;
}
async function open(page, path) {
  await page.goto(origin + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
}

test('gallery defaults and every chart family render', async t => {
  const page = await pageFor(t);
  await open(page, '/');
  assert.deepEqual(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, palette: document.documentElement.dataset.palette })), { theme: 'light', palette: 'linen' });
  assert.ok(await page.locator('[data-card-gallery-grid] .desk-gallery-card:visible').count());
  for (const card of CARD_REGISTRY) {
    await open(page, `/?card=${card.id}&view=monitor`);
    const chart = page.locator(card.id === 'quote-view' || card.id === 'deal-view' ? '[data-deal-workspace] svg' : '[data-gpu-chart-svg]').first();
    await chart.waitFor({ state: 'visible' });
    assert.ok(await chart.locator('path, line, rect, circle').count(), card.id);
    assert.doesNotMatch(await chart.innerHTML(), /NaN|Infinity/, card.id);
  }
});

test('mobile touch navigation, Data and inspection stay usable', async t => {
  for (const [width, height] of [[320, 568], [390, 740], [430, 820], [740, 390]]) {
    await t.test(`${width}×${height}`, async t => {
      const page = await pageFor(t, { viewport: { width, height }, hasTouch: true, isMobile: true });
      const noOverflow = async label => assert.equal(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1), true,
      `${label} has no horizontal page overflow at ${width}×${height}`);
      const reachable = async (locator, label) => {
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.evaluate(node => {
          const r = node.getBoundingClientRect();
          const ticker = document.querySelector('[data-market-strip]').getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth,
            limit: Math.min(innerHeight, ticker.top), hit: node === hit || node.contains(hit) };
        });
        assert.ok(box.left >= -1 && box.right <= box.width + 1 && box.top >= -1 && box.bottom <= box.limit + 1 && box.hit,
          `${label} is reachable above the ticker at ${width}×${height}: ${JSON.stringify(box)}`);
      };
      const navigation = async label => {
        const layout = await page.evaluate(() => {
          const desk = document.querySelector('[data-command-open]').getBoundingClientRect();
          const group = document.querySelector('.desk-view-actions__group').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('[data-desk-mode], [data-command-open]')].map(node => {
            const r = node.getBoundingClientRect();
            return { text: node.textContent.trim(), left: r.left, right: r.right, font: parseFloat(getComputedStyle(node).fontSize),
              clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1 };
          });
          return { buttons, centerDifference: Math.abs(desk.y + desk.height / 2 - group.y - group.height / 2) };
        });
        assert.ok(layout.centerDifference <= 4, `Desk shares the navigation row for ${label}: ${layout.centerDifference}px`);
        for (const button of layout.buttons) assert.ok(button.left >= -1 && button.right <= width + 1 && button.font >= 11 && !button.clipped,
          `${button.text} stays readable for ${label}: ${JSON.stringify(button)}`);
        await noOverflow(label);
      };
      const catalogActions = async label => {
        await page.locator('[data-catalog-switcher]').tap();
        await page.locator('[data-catalog-menu]').waitFor({ state: 'visible' });
        for (const action of ['create', 'cards', 'rename', 'delete']) await reachable(page.locator(`[data-catalog-${action}]`), `${label} catalog ${action}`);
        await noOverflow(`${label} catalog menu`);
        await page.locator('[data-catalog-switcher]').tap();
      };
      await open(page, '/');
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => 'ontouchstart' in window && matchMedia('(pointer: coarse)').matches), true,
        'the context uses touch APIs and a coarse pointer');
      await page.evaluate(() => addEventListener('pointerdown', event => { window.__smokePointerType = event.pointerType; }, { once: true }));
      await navigation('collapsed appearance');
      await catalogActions('collapsed appearance');
      assert.equal(await page.evaluate(() => window.__smokePointerType), 'touch', 'navigation uses a real emulated touch event');
      await page.locator('[data-command-open]').tap();
      if (await page.locator('[data-desk-login]').isVisible()) await page.locator('[data-desk-login]').tap();
      const search = page.locator('[data-command-input]');
      assert.ok(await search.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16), 'mobile search avoids focus zoom');
      if (width === 390) {
        await page.evaluate(() => {
          Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 });
          visualViewport.dispatchEvent(new Event('resize'));
        });
        await page.waitForFunction(() => document.querySelector('[data-command-palette]').style.getPropertyValue('--desk-command-viewport-height') === '400px');
        const keyboardMenu = await page.locator('[data-command-palette]').boundingBox();
        assert.ok(keyboardMenu.y >= 0 && keyboardMenu.y + keyboardMenu.height <= 400,
          `commands fit above the simulated keyboard: ${JSON.stringify(keyboardMenu)}`);
      }
      await search.fill('Show display controls');
      await page.getByRole('option', { name: /^Show display controls/ }).tap();
      await page.waitForFunction(() => document.documentElement.dataset.displayToolbar === 'expanded');
      if (width === 390) {
        assert.equal(await page.locator('[data-command-palette]').evaluate(node => node.style.getPropertyValue('--desk-command-viewport-height')), '',
          'closing commands clears the visual viewport override');
        await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
      }
      await navigation('expanded appearance');
      for (const button of await page.locator('.desk-display-controls button').all()) await reachable(button, 'appearance control');
      await catalogActions('expanded appearance');

      await open(page, '/?card=gpu-index&view=monitor&gpu=H200&layers=H200&range=7d');
      const chart = page.locator('[data-gpu-chart]');
      await reachable(page.locator('[data-monitor-data-toggle]'), 'source disclosure');
      await page.locator('[data-monitor-data-toggle]').tap();
      await page.locator('[data-monitor-data-body]').waitFor({ state: 'visible' });
      for (const control of await page.locator('[data-monitor-data] .desk-data-rail__footer :is(a, button)').all()) await reachable(control, 'source action');
      await noOverflow('expanded source');
      await page.locator('[data-monitor-data-toggle]').tap();
      await chart.scrollIntoViewIfNeeded();
      const line = page.locator('[data-gpu-chart-svg] .gpu-benchmark__line.is-selected');
      const tooltip = page.locator('[data-gpu-tooltip]');
      let previousDate;
      for (const fraction of [0.35, 0.7]) {
        const point = await line.evaluate((node, progress) => {
          const p = node.getPointAtLength(node.getTotalLength() * progress).matrixTransform(node.getScreenCTM());
          return { x: p.x, y: p.y };
        }, fraction);
        await page.touchscreen.tap(point.x, point.y);
        await tooltip.waitFor({ state: 'visible' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await tooltip.isVisible(), true, 'a tapped observation remains after the finger lifts');
        const date = await tooltip.locator('time').textContent();
        assert.ok(date && date !== previousDate, 'a second tap inspects a different recorded observation');
        assert.match(await tooltip.locator('[data-layer="H200"] strong').textContent(), /\d/);
        previousDate = date;
      }

      await open(page, '/?card=gpu-lease&view=craft');
      const data = page.locator('[data-card-compare-toggle]');
      await reachable(data, 'Craft Data toggle');
      const geometry = () => page.locator('.gpu-index-detail').evaluate(node => {
        const r = node.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
      });
      const before = await geometry();
      await data.tap();
      const panel = page.locator('[data-card-compare-panel]');
      await panel.waitFor({ state: 'visible' });
      const after = await geometry();
      for (const key of Object.keys(before)) assert.ok(Math.abs(after[key] - before[key]) <= 1, `Data does not move or resize the chart's ${key}`);
      const panelBox = await panel.boundingBox();
      assert.ok(panelBox.x >= -1 && panelBox.x + panelBox.width <= width + 1 && panelBox.y >= -1 && panelBox.y + panelBox.height <= height + 1,
        `Data fits ${width}×${height}: ${JSON.stringify(panelBox)}`);
      const inputs = panel.locator('input:not([type="hidden"]):not([readonly]):visible');
      assert.ok(await inputs.count(), 'the numeric editor is present');
      for (const input of await inputs.all()) {
        assert.ok(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize) >= 16), 'editable mobile values avoid focus zoom');
        await reachable(input, 'numeric input');
      }
      assert.equal(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'Data scrolls only vertically');
      await noOverflow('Craft Data');
      if (width === 390) {
        await open(page, '/?card=gpu-hedge&view=craft');
        await page.locator('[data-card-compare-toggle]').tap();
        const basis = page.locator('[data-card-option-input="basis"]');
        assert.equal(await basis.getAttribute('inputmode'), 'text', 'signed basis exposes the iPhone minus key');
      }
    });
  }
});

test('Craft type picker stays readable and reachable at every width', async t => {
  const page = await pageFor(t);
  const cardIds = CARD_REGISTRY.filter(card => card.craftable !== false).map(card => card.id);
  await open(page, '/?card=gpu-index&view=craft&draft=new');
  const picker = page.locator('[data-craft-type-list]');
  const buttons = picker.locator('button');
  const data = page.locator('[data-card-compare-toggle]');
  const views = page.locator('[data-craft-home]');
  const motionPreference = async reducedMotion => {
    await page.evaluate(preference => {
      const media = matchMedia('(prefers-reduced-motion: reduce)');
      window.__smokeMotionPreferenceReady = media.matches === (preference === 'reduce')
        ? Promise.resolve()
        : new Promise(resolve => media.addEventListener('change', () => requestAnimationFrame(resolve), { once: true }));
    }, reducedMotion);
    await page.emulateMedia({ reducedMotion });
    // Wait for the emulated preference to reach the browser's change listeners.
    await page.evaluate(() => window.__smokeMotionPreferenceReady);
  };
  const frameGeometry = () => page.evaluate(() =>
    ['.gpu-index-detail', '[data-card-composer]', '[data-craft-home]', '[data-card-compare-toggle]', '[data-card-save]']
      .map(selector => {
        const node = document.querySelector(selector);
        const { x, y, width, height } = node.getBoundingClientRect();
        return { selector, x: x + scrollX, y: y + scrollY, width, height, visible: node.checkVisibility() };
      }));
  const assertFrame = async (expected, label) => {
    const actual = await frameGeometry();
    for (const [index, box] of actual.entries()) {
      assert.equal(box.visible, true, `${box.selector} remains visible for ${label}`);
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(box[dimension] - expected[index][dimension]) <= 1,
          `${box.selector} ${dimension} stays fixed for ${label}: ${box[dimension]} vs ${expected[index][dimension]}`);
      }
    }
    assert.equal(await page.evaluate(() => window.__smokeCraftDocument === document.documentElement &&
      window.__smokeCraftFrame === document.querySelector('.gpu-index-detail') &&
      window.__smokeCraftComposer === document.querySelector('[data-card-composer]')), true,
    `the same document, frame and toolbar survive ${label}`);
  };
  const assertToolbar = async (empty, label) => {
    const controls = await page.locator('[data-card-composer] > button').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {
        label: (node.querySelector('[data-card-data-label]') || node).textContent.trim(),
        disabled: node.disabled, visible: node.checkVisibility(), x: box.x, right: box.right,
      };
    }));
    assert.deepEqual(controls.map(control => control.label), ['Views', 'Data', 'Save'], label);
    assert.equal(controls.every(control => control.visible), true, `all toolbar controls remain visible for ${label}`);
    assert.deepEqual(controls.map(control => control.disabled), [false, empty, empty],
      `Data and Save require a selected type for ${label}`);
    const composer = await page.locator('[data-card-composer]').boundingBox();
    assert.ok(controls[0].x - composer.x <= 16 && controls[1].x >= controls[0].right &&
      controls[1].right < composer.x + composer.width / 2, `Views and Data stay left for ${label}`);
    assert.ok(composer.x + composer.width - controls[2].right <= 16 && controls[2].x > controls[1].right,
      `Save stays right for ${label}`);
  };
  const assertNoChartAnimation = async label => {
    const active = await page.locator('[data-gpu-chart]').evaluate(node =>
      node.getAnimations({ subtree: true }).filter(animation =>
        !animation.transitionProperty &&
        (animation.pending || animation.playState === 'running')).length);
    assert.equal(active, 0, `${label} has no active chart transition`);
    assert.equal(await page.locator('[data-craft-transition-outgoing]').count(), 0,
      `${label} has no outgoing transition content`);
  };
  const assertSelected = async card => {
    await page.waitForURL(url => url.searchParams.get('card') === card && !url.searchParams.has('draft'));
    assert.equal(await page.locator('[data-gpu-benchmark-card]').getAttribute('data-card-id'), card);
    assert.equal(await picker.isVisible(), false, `${card} replaces the chooser`);
    const chart = page.locator(card === 'quote-view' || card === 'deal-view' ? '[data-deal-workspace] svg' : '[data-gpu-chart-svg]').first();
    await chart.waitFor({ state: 'visible' });
    assert.ok(await chart.locator('path, line, rect, circle').count(), `${card} renders after selection`);
    assert.doesNotMatch(await chart.innerHTML(), /NaN|Infinity/, card);
  };
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await picker.scrollIntoViewIfNeeded();
    assert.deepEqual(await buttons.evaluateAll(nodes => nodes.map(node => node.dataset.craftType)), cardIds);
    const layout = await buttons.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {
        id: node.dataset.craftType, left: box.left, right: box.right,
        top: box.top, bottom: box.bottom, width: box.width, height: box.height,
        visible: node.checkVisibility(), enabled: !node.disabled,
        clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      };
    }));
    for (const button of layout) {
      assert.ok(button.visible && button.enabled, `${button.id} reachable at ${width}px`);
      assert.ok(button.width > 0 && button.height > 0 && !button.clipped, `${button.id} label fits at ${width}px`);
      assert.ok(button.left >= -1 && button.right <= width + 1, `${button.id} fits viewport at ${width}px`);
    }
    for (let i = 0; i < layout.length; i++) {
      for (const other of layout.slice(i + 1)) {
        const button = layout[i];
        const overlapWidth = Math.min(button.right, other.right) - Math.max(button.left, other.left);
        const overlapHeight = Math.min(button.bottom, other.bottom) - Math.max(button.top, other.top);
        assert.ok(overlapWidth <= 1 || overlapHeight <= 1, `${button.id} and ${other.id} do not overlap at ${width}px`);
      }
    }
  }
  await page.evaluate(() => {
    window.__smokeCraftDocument = document.documentElement;
    window.__smokeCraftFrame = document.querySelector('.gpu-index-detail');
    window.__smokeCraftComposer = document.querySelector('[data-card-composer]');
  });
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    const reference = await frameGeometry();
    await assertToolbar(true, `chooser at ${width}px`);
    for (const card of cardIds) {
      const label = `${card} at ${width}px`;
      await picker.locator(`[data-craft-type="${card}"]`).click();
      await assertSelected(card);
      await assertNoChartAnimation(`reduced-motion selection of ${label}`);
      await assertFrame(reference, label);
      await assertToolbar(false, label);
      await data.click();
      await page.locator('[data-card-compare-panel]').waitFor({ state: 'visible' });
      await views.click();
      await picker.waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-card-compare-panel]').isVisible(), false,
        `returning to Views closes Data for ${label}`);
      await assertNoChartAnimation(`reduced-motion return from ${label}`);
      await assertFrame(reference, `chooser after ${label}`);
      await assertToolbar(true, `chooser after ${label}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.mouse.move(1, 1);
  await motionPreference('no-preference');
  const keyboardFrame = await frameGeometry();
  await buttons.first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await buttons.nth(1).evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await assertSelected(cardIds[0]);
  await page.waitForFunction(() => document.querySelector('[data-card-compare-toggle]') === document.activeElement);
  await assertNoChartAnimation('keyboard selection with motion enabled');
  await assertFrame(keyboardFrame, 'keyboard selection');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-card-compare-panel]').contains(document.activeElement));
  await page.keyboard.press('Escape');
  assert.equal(await data.evaluate(node => node === document.activeElement), true, 'Data returns focus after Escape');
  await views.focus();
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('[data-craft-type]') === document.activeElement);
  await assertNoChartAnimation('keyboard return to Views with motion enabled');
  await assertFrame(keyboardFrame, 'keyboard return to Views');
  await buttons.last().focus();
  await page.keyboard.press('Enter');
  await assertSelected(cardIds.at(-1));
  await page.waitForFunction(() => document.querySelector('[data-card-compare-toggle]') === document.activeElement);
  await assertNoChartAnimation('cross-family keyboard selection with motion enabled');
  await assertFrame(keyboardFrame, 'cross-family keyboard selection');
  await views.focus();
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'visible' });
  assert.equal(await buttons.last().evaluate(node => node === document.activeElement), true,
    'Views returns keyboard focus to the previously selected type');

  const crossfade = await buttons.first().evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const outgoing = document.querySelector('[data-craft-transition-outgoing]');
    const animations = document.querySelector('.gpu-index-detail').getAnimations({ subtree: true })
      .filter(animation => animation.id.startsWith('desk-craft-') && (animation.pending || animation.playState === 'running'));
    const incoming = animations.find(animation => animation.id === 'desk-craft-content');
    // Seek real presentation frames so a fast browser cannot skip an opacity dip.
    const opacitySamples = [0, 0.25, 0.5, 0.75, 0.99].map(progress => {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
      }
      return Number(getComputedStyle(incoming.effect.target).opacity);
    });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(outgoing).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    for (const animation of animations) {
      animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
      animation.play();
    }
    return {
      ids: animations.map(animation => animation.id).sort(),
      opacitySamples,
      contentOnly: animations.every(animation => animation.effect?.target instanceof Element &&
        Boolean(animation.effect.target.closest('[data-gpu-chart]'))),
      outgoing: outgoing && {
        hidden: outgoing.getAttribute('aria-hidden'), inert: outgoing.inert,
        pointerEvents: getComputedStyle(outgoing).pointerEvents,
        backgroundAlpha: context.getImageData(0, 0, 1, 1).data[3],
        keyframes: outgoing.getAnimations()[0].effect.getKeyframes().map(frame => ({ opacity: frame.opacity, transform: frame.transform })),
        content: outgoing.textContent.trim(),
      },
    };
  });
  assert.deepEqual(crossfade.ids, ['desk-craft-content', 'desk-craft-outgoing'],
    'pointer selection crossfades the previous content into the selected view');
  assert.deepEqual(crossfade.opacitySamples, [1, 1, 1, 1, 1],
    'the incoming chart stays fully painted throughout the transition');
  assert.equal(crossfade.contentOnly, true, 'pointer transitions animate only the chart content');
  assert.ok(crossfade.outgoing?.content, 'the previous chooser remains visible during the crossfade');
  assert.equal(crossfade.outgoing.backgroundAlpha, 255,
    'the outgoing surface has an opaque background so the transition cannot dim both views');
  assert.ok(crossfade.outgoing.keyframes.every(frame => Number(frame.opacity) === 1) &&
    crossfade.outgoing.keyframes.at(-1).transform.startsWith('translateX(-'),
    'the type menu slides left at full opacity rather than blinking away');
  assert.equal(crossfade.outgoing.hidden, 'true', 'outgoing content is hidden from assistive technology');
  assert.equal(crossfade.outgoing.inert, true, 'outgoing controls cannot receive focus');
  assert.equal(crossfade.outgoing.pointerEvents, 'none', 'outgoing controls cannot intercept pointer input');
  await assertFrame(keyboardFrame, 'active pointer transition');
  const interrupted = await page.evaluate(() => {
    const opacities = [];
    const click = selector => {
      document.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      const incoming = document.querySelector('[data-gpu-chart]').getAnimations({ subtree: true })
        .find(animation => animation.id === 'desk-craft-content');
      opacities.push(Number(getComputedStyle(incoming.effect.target).opacity));
      incoming.currentTime = Number(incoming.effect.getTiming().duration) / 2;
    };
    click('[data-craft-home]');
    click('[data-craft-type="quote-view"]');
    click('[data-craft-home]');
    click('[data-craft-type="deal-view"]');
    click('[data-craft-home]');
    click('[data-craft-type="quote-view"]');
    return {
      opacities,
      outgoingCount: document.querySelectorAll('[data-craft-transition-outgoing]').length,
      animations: document.querySelector('[data-gpu-chart]').getAnimations({ subtree: true })
        .filter(animation => animation.id.startsWith('desk-craft-') && (animation.pending || animation.playState === 'running')).length,
    };
  });
  assert.deepEqual(interrupted.opacities, [1, 1, 1, 1, 1, 1],
    'interrupted switches keep each replacement fully painted from its first frame');
  assert.equal(interrupted.outgoingCount, 1, 'rapid switches retain only the latest outgoing content');
  assert.equal(interrupted.animations, 2, 'rapid switches retain only the current crossfade');
  await assertSelected('quote-view');
  await page.waitForFunction(() => !document.querySelector('[data-gpu-chart]').getAnimations({ subtree: true })
    .some(animation => animation.id.startsWith('desk-craft-') && (animation.pending || animation.playState === 'running')));
  assert.equal(await page.locator('[data-craft-transition-outgoing]').count(), 0, 'completed crossfades remove outgoing content');
  await assertFrame(keyboardFrame, 'interrupted pointer selection');
  assert.equal(new URL(page.url()).searchParams.get('card'), 'quote-view', 'the latest selection wins after interrupted transitions');

  await views.dispatchEvent('click', { detail: 1 });
  const duplicateIds = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index));
  assert.deepEqual(duplicateIds, [], 'outgoing chart copies do not duplicate live SVG or control IDs');
  await motionPreference('reduce');
  await assertNoChartAnimation('enabling reduced motion during a pointer transition');
  await motionPreference('no-preference');
  await buttons.first().dispatchEvent('click', { detail: 1 });
  await views.focus();
  await page.keyboard.press('Enter');
  await assertNoChartAnimation('keyboard input interrupts an active pointer transition');
  await assertFrame(keyboardFrame, 'keyboard interruption');

  await views.focus();
  await page.keyboard.press('Enter');
  await buttons.last().focus();
  await page.keyboard.press('Enter');
  await assertSelected(cardIds.at(-1));
  await page.waitForFunction(() => document.querySelector('[data-card-compare-toggle]') === document.activeElement);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'editor focus request is consumed once');
  await page.locator('[data-craft-home]').click();
  await picker.waitFor({ state: 'visible' });
  assert.equal(await buttons.count(), cardIds.length);
  assert.equal(await picker.locator('button:disabled').count(), 0);

  await motionPreference('reduce');
  await buttons.first().dispatchEvent('click', { detail: 0 });
  await assertSelected(cardIds[0]);
  await page.locator('[data-desk-mode="monitor"]').dispatchEvent('click', { detail: 0 });
  await page.waitForFunction(() => document.documentElement.dataset.deskView === 'monitor');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, '/?card=gpu-index&view=monitor&gpu=B300&layers=B300&scale=price&range=7d&palette=sage&theme=dark');
  await page.evaluate(() => {
    window.__smokeCraftEntryFrame = document.querySelector('.gpu-index-detail');
    window.__smokeCraftEntryBounds = window.__smokeCraftEntryFrame.getBoundingClientRect().toJSON();
    window.__smokeCraftEntryDocument = document.documentElement;
    window.__smokeCraftEntryViewTransitions = 0;
    const startViewTransition = document.startViewTransition;
    if (startViewTransition) document.startViewTransition = function (...args) {
      window.__smokeCraftEntryViewTransitions++;
      return startViewTransition.apply(this, args);
    };
  });
  await motionPreference('no-preference');
  await page.evaluate(() => {
    document.querySelector('[data-desk-mode="craft"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    document.getAnimations().filter(animation => animation.id.startsWith('desk-craft-')).forEach(animation => {
      animation.pause();
      animation.currentTime = 0;
    });
  });
  await page.waitForFunction(() => document.documentElement.dataset.deskView === 'craft' &&
    document.querySelector('[data-gpu-chart]').getAnimations({ subtree: true })
      .some(animation => animation.id === 'desk-craft-content'));
  const entry = await page.evaluate(() => ({
    sameFrame: window.__smokeCraftEntryFrame === document.querySelector('.gpu-index-detail'),
    sameDocument: window.__smokeCraftEntryDocument === document.documentElement,
    pageTransitions: window.__smokeCraftEntryViewTransitions,
    before: window.__smokeCraftEntryBounds,
    firstFrame: document.querySelector('.gpu-index-detail').getBoundingClientRect().toJSON(),
    outsideFrame: document.getAnimations().filter(animation => animation.id.startsWith('desk-craft-'))
      .some(animation => !animation.effect?.target?.closest('.gpu-index-detail')),
    surface: getComputedStyle(document.querySelector('[data-craft-transition-outgoing]')).backgroundColor,
  }));
  assert.equal(entry.sameFrame && entry.sameDocument, true, 'opening Craft preserves the current document and frame');
  assert.equal(entry.pageTransitions, 0, 'opening Craft does not animate a page snapshot');
  assert.equal(entry.outsideFrame, false, 'opening Craft leaves the surrounding page untouched');
  for (const dimension of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(entry.before[dimension] - entry.firstFrame[dimension]) <= 1,
      `Craft starts at the visible Monitor ${dimension}, rather than jumping to the new layout`);
  }
  assert.equal(entry.surface, 'rgb(24, 24, 24)', 'the first outgoing surface stays dark');
  await motionPreference('reduce');
  await assertNoChartAnimation('reduced motion interrupts opening Craft');
  assert.equal(await page.locator('.gpu-index-detail').evaluate(node => getComputedStyle(node).transform), 'none',
    'reduced motion immediately settles the frame');

  await buttons.first().dispatchEvent('click', { detail: 0 });
  await motionPreference('no-preference');
  const fallback = await page.evaluate(() => {
    document.startViewTransition = undefined;
    document.querySelector('[data-desk-mode="monitor"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    const animations = document.getAnimations().filter(animation => !animation.transitionProperty &&
      animation.effect?.target?.closest('.desk-stage'));
    return {
      mode: document.documentElement.dataset.deskView,
      opacityDips: animations.some(animation => animation.effect.getKeyframes()
        .some(frame => frame.opacity !== undefined && Number(frame.opacity) < 1)),
      chartReveals: animations.some(animation => animation.id.startsWith('desk-chart-')),
    };
  });
  assert.equal(fallback.mode, 'monitor', 'fallback navigation never waits for the old screen to fade out');
  assert.equal(fallback.opacityDips || fallback.chartReveals, false,
    'fallback navigation moves fully painted content without a screen fade or second chart reveal');

  await open(page, '/?card=gpu-index&view=monitor&gpu=B300&layers=B300&range=7d&palette=sage&theme=dark&entry=preset-gpu-index-b300');
  await page.locator('[data-desk-mode="catalog"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.deskView === 'catalog' &&
    !document.getAnimations().some(animation => animation.effect?.pseudoElement));
  const unmatched = await page.evaluate(() => {
    let calls = 0;
    const nativeTransition = document.startViewTransition;
    document.startViewTransition = (...args) => { calls++; return nativeTransition.apply(document, args); };
    document.querySelector('[data-desk-mode="monitor"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    return { calls, mode: document.documentElement.dataset.deskView };
  });
  assert.equal(unmatched.calls, 0, 'a card absent from the catalog does not create an unmatched browser snapshot');
  assert.equal(unmatched.mode, 'monitor', 'an unmatched chart is drawn immediately');
});

test('Desk commands keep keyboard control and preserve Craft drafts', async t => {
  const page = await pageFor(t);
  for (const [card, composition, range] of [
    ['gpu-index', 'gpu=H200&layers=H200,H100&scale=price', 'all'],
    ['equities', 'symbol=CRWV&layers=CRWV,H100,H200&scale=index&style=bars', '90d'],
  ]) {
    await page.emulateMedia({ reducedMotion: card === 'gpu-index' ? 'no-preference' : 'reduce' });
    await open(page, `/?card=${card}&view=craft&${composition}&range=${range}`);
    await page.locator('[data-desk-mode="monitor"]').click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === 'monitor');
    const draftKey = `desk.craft-draft.v1.${card}`;
    const storedDraft = await page.evaluate(key => sessionStorage.getItem(key), draftKey);
    assert.ok(storedDraft, 'leaving Craft preserves the unfinished view');
    assert.equal(JSON.parse(storedDraft).cardState.range, range);
    await page.locator('[data-gpu-range="7d"]').click();
    if (card === 'gpu-index') {
      await page.locator('[data-desk-mode="catalog"]').click();
      await page.waitForFunction(() => document.documentElement.dataset.deskView === 'catalog');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), storedDraft, 'Monitor changes do not replace the Craft draft');
      await page.locator('[data-desk-mode="craft"]').click();
      await page.locator('[data-craft-type-list]').waitFor({ state: 'visible' });
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('[data-card-ready="true"]'));
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), storedDraft, 'reload preserves the draft');
    assert.equal(await page.locator('.desk-brand, .desk-corners a, [data-desk-clock]').count(), 0, 'the page corner has no label, article link or clock');
    await page.locator('[data-command-open]').click();
    const entry = page.locator('[data-desk-entry]');
    assert.equal(await entry.locator('.desk-command-menu__byline').count(), 0, 'login has no byline');
    await page.waitForFunction(() => document.querySelector('[data-desk-login]') === document.activeElement);
    if (card === 'gpu-index') {
      await page.locator('[data-desk-login]').click();
      assert.equal(await page.locator('[data-command-content]').evaluate(node => !node.hidden && !node.inert), true, 'pointer login reveals commands without an artificial wait');
    } else await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-command-input]') === document.activeElement);
    await entry.waitFor({ state: 'hidden' });
    assert.equal(await entry.evaluate(node => node.hidden && node.inert), true, 'keyboard login hides and disables the entry');
    if (card === 'gpu-index') {
      const search = page.locator('[data-command-input]');
      const rows = page.locator('[data-command-results] [role="option"]');
      assert.equal(await page.locator('.desk-command-menu__shortcut').count(), 0);
      assert.doesNotMatch(await page.locator('.desk-command-menu__footer').textContent(), /Resource index/);
      await search.fill('prices');
      await page.waitForFunction(() => document.querySelector('[data-command-results] [role="option"] strong')?.textContent === 'Open Latest prices');
      assert.equal(await rows.first().getAttribute('aria-selected'), 'true', 'new query selects its most relevant match');
      assert.equal(await page.locator('[data-command-results] .desk-command-menu__group').count(), 0, 'search does not repeat group headings');
      assert.equal(await rows.evaluateAll(nodes => nodes.every(node => node.tabIndex === -1)), true);
      await search.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-command-content] [data-command-close]')), true);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await search.evaluate(node => node === document.activeElement), true);
      await rows.first().focus();
      assert.equal(await search.evaluate(node => node === document.activeElement), true, 'option focus returns to search');
      const active = await search.getAttribute('aria-activedescendant');
      await search.press('ArrowDown');
      assert.notEqual(await search.getAttribute('aria-activedescendant'), active);
      await search.fill('Copy view link');
      await page.waitForFunction(() => document.querySelector('[data-command-results] [role="option"] strong')?.textContent === 'Copy view link');
      assert.equal(await rows.first().isDisabled(), true, 'an empty Craft view has no view link to copy');
      assert.equal(await rows.first().getAttribute('aria-selected'), 'false', 'disabled commands are not the active result');
      assert.equal(await rows.first().locator('small, .desk-command-menu__meta').count(), 0, 'simple actions have no path or repeated hint');
    }
    await page.locator('[data-command-input]').fill('Resume draft');
    await page.getByRole('option', { name: /Resume draft/ }).click();
    await page.waitForFunction(() => document.documentElement.dataset.deskView === 'craft' && document.querySelector('[data-gpu-benchmark-card]').dataset.craftEmpty === 'false');
    await page.waitForURL(url => url.searchParams.get('view') === 'craft' && url.searchParams.get('range') === range);
    assert.equal(new URL(page.url()).searchParams.get('card'), card);
    assert.equal(new URL(page.url()).searchParams.get('range'), range, 'the authored range returns, not the later Monitor range');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), draftKey), null, 'resuming consumes the stored draft');
  }
});

test('Data controls and source disclosures keep the chart in place', async t => {
  const page = await pageFor(t);
  const toggle = page.locator('[data-card-compare-toggle]');
  const panel = page.locator('[data-card-compare-panel]');
  const craftGeometry = () => page.evaluate(() =>
    ['[data-gpu-chart]', '.gpu-index-detail', '[data-card-composer]'].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    }));
  const assertCraftGeometry = (actual, expected, message) => {
    for (const [index, box] of actual.entries()) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(box[dimension] - expected[index][dimension]) <= 1,
          `${message}: ${['chart', 'frame', 'composer'][index]} ${dimension}`);
      }
    }
  };
  const headerByWidth = new Map();
  const assertCraftHeader = async (label, width) => {
    const header = await page.locator('[data-card-composer]').evaluate(node => {
      const composer = node.getBoundingClientRect();
      const controls = [...node.querySelectorAll(':scope > button')]
        .filter(button => button.checkVisibility())
        .map(button => {
          const box = button.getBoundingClientRect();
          return {
            label: (button.querySelector('[data-card-data-label]') || button).innerText.trim(),
            x: box.x - composer.x, y: box.y - composer.y,
            width: box.width, height: box.height,
            clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
          };
        });
      return { width: composer.width, controls };
    });
    assert.deepEqual(header.controls.map(control => control.label), ['Views', 'Data', 'Save'],
      `Craft uses the same three header controls for ${label}`);
    const [views, data, save] = header.controls;
    assert.ok(views.x >= -1 && views.x <= 16 && data.x >= views.x + views.width &&
      data.x + data.width < header.width / 2, `Views and Data stay together on the left for ${label}`);
    assert.ok(save.x > data.x + data.width && header.width - save.x - save.width >= -1 &&
      header.width - save.x - save.width <= 16, `Save stays on the right for ${label}`);
    for (const control of header.controls) {
      assert.ok(control.height > 0 && control.height <= 44 && !control.clipped,
        `${control.label} stays compact and readable for ${label}`);
      assert.ok(Math.abs(control.y + control.height / 2 - views.y - views.height / 2) <= 1,
        `${control.label} shares the header baseline for ${label}`);
    }
    if (!headerByWidth.has(width)) headerByWidth.set(width, header);
    const reference = headerByWidth.get(width);
    for (const [index, control] of header.controls.entries()) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(control[dimension] - reference.controls[index][dimension]) <= 1,
          `${control.label} ${dimension} is consistent across Craft types for ${label}`);
      }
    }
  };
  const assertDataFits = async label => {
    const layout = await panel.evaluate(node => {
      const bounds = node.getBoundingClientRect();
      const selectors = '.gpu-benchmark__input-field > span, .gpu-benchmark__input-display, .gpu-benchmark__month-trigger, .deal-craft__field > span:first-child, input:not([hidden]), [data-card-primary], [data-card-layer], [data-card-option], [data-depth-craft-scale]';
      const fields = [...node.querySelectorAll(selectors)]
        .filter(field => field.checkVisibility({ visibilityProperty: true }))
        .map(field => {
          const box = field.getBoundingClientRect();
          return {
            label: field.getAttribute('aria-label') || field.textContent || field.value,
            contained: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
            clipped: field.scrollWidth > field.clientWidth + 1 || field.scrollHeight > field.clientHeight + 1,
            choiceHeight: field.matches('button[data-card-primary], button[data-card-layer], button[data-card-option], button[data-depth-craft-scale]') ? box.height : null,
          };
        });
      return { overflows: node.scrollWidth > node.clientWidth + 1, fields };
    });
    assert.equal(layout.overflows, false, `Data has no horizontal overflow for ${label}`);
    for (const field of layout.fields) {
      assert.ok(field.contained && !field.clipped, `${field.label.trim()} fits in Data for ${label}`);
      if (field.choiceHeight !== null) {
        assert.ok(field.choiceHeight <= 44, `${field.label.trim()} keeps a compact button height for ${label}`);
      }
    }
  };
  const dataEdits = [
    ['gpu-index', '[data-card-primary="B200"]', 'gpu', 'B200'],
    ['gpu-price-snapshot', '[data-card-primary="B300"]', 'gpu', 'B300'],
    ['gpu-market-depth', '[data-card-option="target"][data-card-option-value="256"]', 'target', '256'],
    ['equities', '[data-card-primary="NVDA"]', 'symbol', 'NVDA'],
    ['power-basis', '[data-card-primary="ERCOT-NORTH"]', 'location', 'ERCOT-NORTH'],
    ['forward-prices', '[data-card-primary="H200"]', 'gpu', 'H200'],
    ['gpu-hedge', '[data-card-option-input="hours"]', 'hours', '250000'],
    ['gpu-lease', '[data-card-option-input="term"]', 'term', '24'],
    ['sandbox-cost', '[data-card-primary="blaxel"]', 'provider', 'blaxel'],
    ['quote-view', '[data-deal-craft-quantity]', 'quantity', '512'],
    ['deal-view', '[data-deal-craft-quantity]', 'quantity', '512'],
  ];
  assert.deepEqual(dataEdits.map(([id]) => id).sort(),
    CARD_REGISTRY.filter(card => card.craftable !== false).map(card => card.id).sort(),
    'every Craft card has a Data regression case');
  for (const [width, height] of [[1440, 1000], [900, 900], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    for (const [card, selector, parameter, value] of dataEdits) {
      if (width === 900 && !['gpu-hedge', 'gpu-lease'].includes(card)) continue;
      const composition = card === 'equities' ? '&symbol=CRWV&scale=index&layers=CRWV,H100,H200&range=90d&style=bars' : '';
      await open(page, `/?card=${card}&view=craft${composition}`);
      await toggle.scrollIntoViewIfNeeded();
      const label = `${card} at ${width}×${height}`;
      await assertCraftHeader(label, width);
      const closed = await craftGeometry();
      await toggle.click();
      await panel.waitFor({ state: 'visible' });
      const controls = await panel.boundingBox();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', label);
      assertCraftGeometry(await craftGeometry(), closed, `opening Data keeps ${label} in place`);
      assert.ok(controls.x >= -1 && controls.x + controls.width <= width + 1 &&
        controls.y >= -1 && controls.y + controls.height <= height + 1, `Data fits the viewport for ${label}`);
      assert.ok(controls.height <= 321, `Data height is bounded for ${label}`);
      assert.ok(Math.abs(controls.x - closed[2].x) <= 1 && Math.abs(controls.width - closed[2].width) <= 1,
        `Data spans the composer for ${label}`);
      await assertDataFits(label);

      const edit = panel.locator(selector);
      if (await edit.evaluate(node => node instanceof HTMLInputElement)) {
        await edit.fill(value);
        await edit.press('Tab');
      } else await edit.click();
      await page.waitForURL(url => url.searchParams.get(parameter) === value);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `editing keeps Data open for ${label}`);
      assertCraftGeometry(await craftGeometry(), closed, `editing Data keeps ${label} in place`);
      await assertDataFits(label);

      if (card === 'gpu-market-depth') {
        const depth = panel.locator('[data-depth-craft]');
        assert.equal(await depth.isVisible(), true, `market depth settings belong to Data for ${label}`);
        assert.equal(await page.locator('[data-depth-target-trigger], [data-depth-view-trigger], [data-depth-target-menu], [data-depth-view-menu]').count(), 0,
          'market depth has no separate target or chart dropdowns');
        const targets = depth.locator('[data-depth-target-options] [role="radio"]');
        assert.deepEqual(await targets.evaluateAll(nodes => nodes.map(node => node.dataset.cardOptionValue)), ['64', '128', '256']);
        assert.equal(await targets.evaluateAll(nodes => nodes.every(node => node.checkVisibility())), true,
          `target choices are inline for ${label}`);
        assert.equal(await edit.getAttribute('aria-checked'), 'true');
        await edit.focus();
        await edit.press('ArrowLeft');
        await page.waitForURL(url => url.searchParams.get('target') === '128');
        const selectedTarget = depth.locator('[data-depth-target-options] [role="radio"][aria-checked="true"]');
        assert.equal(await selectedTarget.getAttribute('data-card-option-value'), '128');
        assert.equal(await selectedTarget.evaluate(node => node === document.activeElement), true,
          `keyboard target selection keeps focus on its inline choice for ${label}`);
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assertCraftGeometry(await craftGeometry(), closed, `keyboard target editing keeps ${label} in place`);

        const scales = depth.locator('[data-depth-craft-views] [data-depth-craft-scale]');
        assert.deepEqual(await scales.evaluateAll(nodes => nodes.map(node => node.dataset.depthCraftScale)), ['depth', 'history']);
        assert.equal(await scales.evaluateAll(nodes => nodes.every(node => node.checkVisibility())), true,
          `chart choices are inline for ${label}`);
        for (const scale of ['history', 'depth']) {
          const choice = depth.locator(`[data-depth-craft-scale="${scale}"]`);
          await choice.focus();
          await choice.press('Enter');
          await page.waitForURL(url => url.searchParams.get('scale') === scale);
          assert.equal(await choice.getAttribute('aria-pressed'), 'true');
          assert.equal(await choice.evaluate(node => node === document.activeElement), true,
            `keyboard chart selection keeps focus on its inline choice for ${label}`);
          const rendering = scale === 'history' ? '[data-depth-history-heatmap]' : '[data-depth-current-profile]';
          assert.equal(await page.locator(`[data-gpu-chart-svg] ${rendering}`).count(), 1,
            `${scale} renders after changing the depth chart for ${label}`);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
          assertCraftGeometry(await craftGeometry(), closed, `switching depth to ${scale} keeps ${label} in place`);
          await assertDataFits(`${label} with ${scale}`);
        }
      }

      if (card === 'gpu-price-snapshot' && width === 1440) {
        await panel.locator('[data-card-layer="H200"]').click();
        await page.waitForURL(url => url.searchParams.get('layers')?.split(',').length === 3);
        assert.deepEqual(new URL(page.url()).searchParams.get('layers').split(',').sort(), ['B200', 'B300', 'H100']);
        assert.equal(await panel.locator('[data-card-primary="B300"]').getAttribute('aria-checked'), 'true');
        assert.equal(await panel.locator('[data-card-layer="H200"]').getAttribute('aria-pressed'), 'false');
        const compact = await panel.boundingBox();
        assert.ok(compact.height >= 80 && compact.height <= 88, 'snapshot Data stays near 83px for its two compact rows');
        await assertDataFits('snapshot after highlighting B300 and removing H200');
        assertCraftGeometry(await craftGeometry(), closed, 'changing snapshot bars keeps the chart in place');
      }

      if (card === 'gpu-lease' && width === 320) {
        const cost = panel.locator('[data-card-option-input="cost"]');
        await cost.fill('1000000000000');
        await cost.press('Tab');
        await page.waitForURL(url => url.searchParams.get('cost') === '1000000000000');
        assert.equal(await panel.locator('[data-option-field="cost"] .gpu-benchmark__input-display').textContent(),
          '1,000,000,000,000', 'the largest valid equipment cost remains readable');
        await assertDataFits(`${label} with the largest valid equipment cost`);
        assertCraftGeometry(await craftGeometry(), closed, 'editing a long cost keeps the chart in place');
      }

      if (card === 'equities' && width === 320) {
        assert.equal(await panel.evaluate(node => node.scrollHeight > node.clientHeight), true,
          'the tall equities controls have their own scroll area');
        await panel.evaluate(node => { node.scrollTop = 0; });
        const scrollY = await page.evaluate(() => window.scrollY);
        await page.mouse.move(controls.x + controls.width / 2, controls.y + controls.height / 2);
        await page.mouse.wheel(0, 240);
        await page.waitForFunction(() => document.querySelector('[data-card-compare-panel]').scrollTop > 0);
        assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'scrolling Data does not scroll the document');
        assertCraftGeometry(await craftGeometry(), closed, 'scrolling Data keeps the chart and frame in place');
      }

      if (card === 'gpu-hedge') {
        const more = panel.locator('.gpu-benchmark__calculator-more');
        const summary = more.locator('summary');
        const collapsed = await panel.boundingBox();
        await summary.click();
        const fields = more.locator('[data-option-field]');
        await fields.first().waitFor({ state: 'visible' });
        const summaryBounds = await summary.boundingBox();
        const fieldBounds = await fields.evaluateAll(nodes => nodes.map(node => {
          const { left, top, bottom } = node.getBoundingClientRect();
          return { left, top, bottom };
        }));
        for (const field of fieldBounds) {
          assert.ok(field.left >= summaryBounds.x + summaryBounds.width - 1,
            `Costs & basis fields open to the right of the summary for ${label}`);
        }
        assert.ok(fieldBounds[0].top < summaryBounds.y + summaryBounds.height &&
          fieldBounds[0].bottom > summaryBounds.y, `Costs & basis starts beside the summary for ${label}`);
        if (width >= 900) {
          assert.ok(Math.abs((await panel.boundingBox()).height - collapsed.height) <= 1,
            `opening Costs & basis keeps Data height unchanged for ${label}`);
        }
        await assertDataFits(`${label} with Costs & basis expanded`);
        assertCraftGeometry(await craftGeometry(), closed, `expanding Costs & basis keeps ${label} in place`);

        const profit = page.locator('[data-gpu-chart-svg] [data-gpu-hedge-hedged]');
        for (const [option, value] of [['costs', '125000'], ['basis', '0.25']]) {
          const priorProfit = await profit.textContent();
          const input = more.locator(`[data-card-option-input="${option}"]`);
          await input.fill(value);
          await input.press('Shift+Tab');
          await page.waitForURL(url => url.searchParams.get(option) === value);
          assert.notEqual(await profit.textContent(), priorProfit, `editing ${option} updates Hedge profit for ${label}`);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'true', `editing ${option} keeps Data open for ${label}`);
          assert.equal(await more.evaluate(node => node.open), true, `editing ${option} keeps Costs & basis open for ${label}`);
        }
        await assertDataFits(`${label} after editing Costs & basis`);
        assertCraftGeometry(await craftGeometry(), closed, `editing Costs & basis keeps ${label} in place`);

        await summary.focus();
        await summary.press('Enter');
        await fields.first().waitFor({ state: 'hidden' });
        assert.equal(await more.evaluate(node => node.open), false, `Enter closes Costs & basis for ${label}`);
        assert.equal(await summary.evaluate(node => node === document.activeElement), true,
          `closing Costs & basis keeps summary focus for ${label}`);
        await summary.press('Space');
        await fields.first().waitFor({ state: 'visible' });
        assert.equal(await more.evaluate(node => node.open), true, `Space opens Costs & basis for ${label}`);
      }

      if (card === 'gpu-hedge' && width <= 390) {
        const month = panel.locator('.gpu-benchmark__month-trigger');
        const calendar = panel.getByRole('dialog', { name: 'Settlement month' });
        await month.click();
        await calendar.waitFor({ state: 'visible' });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'the month picker preserves the Data panel');
        const monthBounds = await calendar.boundingBox();
        assert.ok(monthBounds.x >= -1 && monthBounds.x + monthBounds.width <= width + 1 &&
          monthBounds.y >= -1 && monthBounds.y + monthBounds.height <= height + 1,
          `the month picker fits the viewport for ${label}`);
        await page.keyboard.press('Escape');
        await calendar.waitFor({ state: 'hidden' });
        assert.equal(await month.evaluate(node => node === document.activeElement), true, 'month Escape restores its trigger');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'month Escape leaves Data open');
        await month.press('ArrowDown');
        await calendar.getByRole('button', { name: 'November 2026', exact: true }).click();
        await page.waitForURL(url => url.searchParams.get('delivery') === '2026-11');
        await calendar.waitFor({ state: 'hidden' });
        assertCraftGeometry(await craftGeometry(), closed, 'changing the settlement month keeps the chart in place');
      }

      await toggle.click();
      await panel.waitFor({ state: 'hidden' });
      assertCraftGeometry(await craftGeometry(), closed, `closing Data keeps ${label} in place`);
      await assertCraftHeader(`${label} after editing`, width);
      if (width === 390) {
        await toggle.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-card-compare-panel]').contains(document.activeElement));
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `Escape closes Data for ${label}`);
        assert.equal(await toggle.evaluate(node => node === document.activeElement), true, `Escape restores Data focus for ${label}`);
        assertCraftGeometry(await craftGeometry(), closed, `keyboard Data controls keep ${label} in place`);

        await toggle.click();
        await page.locator('[data-card-save]').click();
        await page.locator('[data-save-dialog]').waitFor({ state: 'visible' }).catch(error => {
          throw new Error(`Save opens from Data for ${label}`, { cause: error });
        });
        assert.equal(await panel.isVisible(), false, `Save closes Data for ${label}`);
        await page.locator('[data-save-cancel]').click();
        await page.locator('[data-save-dialog]').waitFor({ state: 'hidden' });
        assertCraftGeometry(await craftGeometry(), closed, `cancelling Save keeps ${label} in place`);
        await toggle.click();
        await page.locator('[data-craft-home]').click();
        await page.locator('[data-craft-type-list]').waitFor({ state: 'visible' });
        assert.equal(await panel.isVisible(), false, `Views closes Data and returns to the chooser for ${label}`);
      }
    }
  }

  const geometry = () => page.evaluate(() => ({
    scrolls: document.documentElement.scrollHeight > innerHeight,
    overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    boxes: ['.desk-stage', '.gpu-index-detail', '.desk-top-controls'].map(selector => {
      const { x, y, width } = document.querySelector(selector).getBoundingClientRect();
      return { x, y: y + (selector === '.desk-top-controls' ? 0 : scrollY), width };
    }),
  }));
  // The compact mobile shell fits an open source at 850px; use a short phone
  // here so this still exercises the transition into a scrolling document.
  for (const [card, width, height] of [['gpu-index', 1440, 850], ['equities', 1440, 850], ['gpu-index', 320, 568]]) {
    await page.setViewportSize({ width, height });
    await open(page, `/?card=${card}&view=monitor`);
    // Exercise classic scrollbars even on hosts that use overlay scrollbars.
    await page.addStyleTag({ content: 'html::-webkit-scrollbar { width: 16px; }' });
    const disclosure = page.locator('[data-monitor-data-toggle]');
    const before = await geometry();
    assert.equal(before.scrolls, false, 'collapsed source fits without scrolling');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    const expanded = await geometry();
    assert.equal(expanded.scrolls, true, 'expanded source introduces vertical scrolling');
    assert.deepEqual(expanded.boxes, before.boxes, `${card} chart and navigation stay fixed on open at ${width}px`);
    assert.equal(expanded.overflows, false, 'no horizontal overflow with a scrollbar');
    await page.keyboard.press('Escape');
    const closed = await geometry();
    assert.deepEqual(closed.boxes, before.boxes, `${card} chart and navigation stay fixed on close at ${width}px`);
    assert.equal(closed.overflows, false);
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(await disclosure.evaluate(node => node === document.activeElement), true);
  }
});

test('range switching keeps the same view and document', async t => {
  const page = await pageFor(t);
  for (const [card, ranges] of [['gpu-index', ['7d', 'all', '1d']], ['sandbox-cost', ['now', '7d', 'all']], ['forward-prices', ['now', 'all']]]) {
    await open(page, `/?card=${card}&view=monitor`);
    await page.evaluate(() => { window.__smokeDocument = document.documentElement; });
    const selected = await page.locator('[data-catalog-entry-key][aria-selected="true"]').getAttribute('data-catalog-entry-key');
    for (const range of ranges) {
      await page.locator(`[data-gpu-range="${range}"]`).click();
      await page.waitForFunction(range => document.querySelector(`[data-gpu-range="${range}"]`)?.getAttribute('aria-pressed') === 'true', range);
      assert.equal(new URL(page.url()).searchParams.get('card'), card);
      assert.equal(await page.evaluate(() => window.__smokeDocument === document.documentElement), true);
      assert.equal(await page.locator('[data-catalog-entry-key][aria-selected="true"]').getAttribute('data-catalog-entry-key'), selected);
      if (card === 'forward-prices') {
        assert.equal(await page.locator('[data-gpu-chart-svg] [data-forward-delivery]').count(), 5);
        assert.match(await page.locator('[data-gpu-chart-svg]').textContent(), /Apr 2027/);
        const target = await page.locator('[data-gpu-chart-svg] path[data-forward-series]').first().evaluate(path => {
          const p = path.getPointAtLength(path.getTotalLength() * .55);
          const screen = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
          return { x: screen.x, y: screen.y };
        });
        await page.mouse.move(target.x, target.y);
        const cursor = page.locator('[data-gpu-chart-svg] [data-forward-cursor]');
        assert.equal(await cursor.getAttribute('visibility'), null);
        assert.equal(await cursor.locator('line').count(), 0);
        const position = await cursor.locator('circle').evaluate(circle => {
          const p = new DOMPoint(+circle.getAttribute('cx'), +circle.getAttribute('cy')).matrixTransform(circle.getScreenCTM());
          return {x:p.x, y:p.y};
        });
        assert.ok(Math.hypot(position.x-target.x, position.y-target.y) < 1, 'marker follows rendered path');
        await page.mouse.move(0, 0);
        assert.equal(await cursor.getAttribute('visibility'), 'hidden');
        if (range === 'all') {
          assert.match(await page.locator('[data-gpu-chart-svg]').textContent(), /Quoted/);
          const band = await page.locator('[data-gpu-chart-svg]').evaluate(svg => {
            const p = new DOMPoint(svg.viewBox.baseVal.width * .5, svg.viewBox.baseVal.height * .65);
            const region = [...svg.querySelectorAll('[data-forward-region]')].reverse().find(node => node.isPointInFill(p));
            const screen = p.matrixTransform(svg.getScreenCTM());
            return { x: screen.x, y: screen.y, key: region.dataset.forwardRegion, fill: region.getAttribute('fill') };
          });
          const region = page.locator(`[data-gpu-chart-svg] [data-forward-region="${band.key}"]`);
          await page.mouse.move(band.x, band.y);
          assert.match(await page.locator('[data-gpu-chart-svg] [data-forward-readout]').textContent(), /Quoted .*→.*202[67]/);
          assert.notEqual(await region.evaluate(node => node.style.fill), band.fill);
          await page.mouse.move(0, 0);
          assert.equal(await region.evaluate(node => node.style.fill), band.fill);
        }
      }
    }
  }
});

test('a shared desk preserves personal views and stable mode navigation', async t => {
  const page = await pageFor(t);
  await open(page, '/');
  const before = await page.evaluate(() => [localStorage.getItem('desk.catalog.v2'), localStorage.getItem('desk.catalog-collections.v1')]);
  const navigationLayout = () => page.evaluate(() => {
    const toolbar = document.querySelector('.desk-top-controls').getBoundingClientRect();
    const desk = document.querySelector('.desk-search').getBoundingClientRect();
    const modes = document.querySelector('.desk-view-actions__group').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('[data-desk-mode]')].map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    return {
      top: toolbar.top, bottom: toolbar.bottom, center: toolbar.x + toolbar.width / 2, buttons,
      deskCenterY: desk.y + desk.height / 2, modesCenterY: modes.y + modes.height / 2,
      stageTop: document.querySelector('.desk-stage').getBoundingClientRect().top + window.scrollY,
    };
  });
  const referenceByWidth = new Map();
  for (const name of ['Shared desk', 'Worldwide compute and energy market observations']) {
    const desk = createSharedDesk({ name, palette: 'sage', theme: 'dark', entries: [
      { cardId: 'gpu-index', name: 'H200', state: { gpu: 'H200', range: '7d' } },
      { cardId: 'sandbox-cost', name: 'Sandbox', state: { range: '7d' } },
    ] });
    for (const width of [320, 390, 641, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, `/?view=gallery#desk=${encodeSharedDesk(desk)}`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('[data-shared-desk-name]').innerText(), `${name} Shared`);
      assert.equal(await page.locator('[data-catalog-switcher-name]').textContent(), name);
      assert.equal(await page.locator('[data-card-gallery-grid] .desk-gallery-card:visible').count(), 2);
      if (!referenceByWidth.has(width)) referenceByWidth.set(width, await navigationLayout());
      const reference = referenceByWidth.get(width);
      const assertStableNavigation = async mode => {
        const current = await navigationLayout();
        const label = `${mode}, ${name}, ${width}px`;
        assert.ok(Math.abs(current.top - reference.top) <= 1, `toolbar top stays fixed: ${label}`);
        assert.ok(Math.abs(current.center - reference.center) <= 1, `toolbar center stays fixed: ${label}`);
        if (width > 960) assert.ok(Math.abs(current.deskCenterY - current.modesCenterY) <= 1, `Desk is vertically centered with navigation: ${label}`);
        assert.ok(current.bottom <= current.stageTop + 1, `toolbar clears workspace content: ${label}`);
        for (const [index, box] of current.buttons.entries()) {
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(box[key] - reference.buttons[index][key]) <= 1, `mode button ${index} ${key} stays fixed: ${label}`);
          }
          assert.ok(box.x >= 0 && box.x + box.width <= width, `mode button ${index} fits viewport: ${label}`);
        }
      };
      for (const mode of ['catalog', 'monitor', 'craft']) {
        if (mode !== 'catalog') await page.locator(`[data-desk-mode="${mode}"]`).click();
        await page.waitForFunction(mode => document.documentElement.dataset.deskView === mode, mode);
        if (mode === 'craft') await page.locator('[data-craft-type-list]').waitFor({ state: 'visible' });
        await assertStableNavigation(`${mode}, collapsed`);
        await page.locator('[data-command-open]').click();
        if (await page.locator('[data-desk-login]').isVisible()) await page.locator('[data-desk-login]').click();
        await page.locator('[data-command-input]').fill('Show display controls');
        await page.getByRole('option', { name: /^Show display controls/ }).click();
        await page.waitForFunction(() => document.documentElement.dataset.displayToolbar === 'expanded');
        await assertStableNavigation(`${mode}, expanded`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.documentElement.dataset.displayToolbar === 'collapsed');
        await assertStableNavigation(`${mode}, collapsed again`);
      }
    }
  }
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('desk.catalog.v2'), localStorage.getItem('desk.catalog-collections.v1')]), before);
});

test('mixed comparison styles keep data, inspection and saved rendering intact', async t => {
  const page = await pageFor(t);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const state = { symbol: 'CRWV', layers: ['CRWV', 'H100', 'H200'], scale: 'index', range: '90d', style: 'bars' };
  await open(page, '/?card=equities&view=craft&symbol=CRWV&layers=CRWV,H100,H200&scale=index&range=90d');
  const chart = page.locator('[data-gpu-chart-svg]');
  const labels = await chart.locator('.gpu-benchmark__line-label').allTextContents();
  await page.locator('[data-card-compare-toggle]').click();
  const barsStyle = page.locator('[data-card-option="style"][data-card-option-value="bars"]');
  await barsStyle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('style') === 'bars');
  await page.waitForFunction(() => !document.querySelector('[data-gpu-chart-svg]').getAnimations({ subtree: true }).some(animation => animation.id.startsWith('desk-chart-')));
  assert.equal(await chart.locator('[data-comparison-bars]').count(), 2);
  assert.equal(await chart.locator('.gpu-benchmark__line').count(), 1);
  assert.deepEqual(await chart.locator('.gpu-benchmark__line-label').allTextContents(), labels);
  const slider = chart.locator('[role="slider"]');
  await slider.focus();
  await slider.press('End');
  assert.match(await slider.getAttribute('aria-valuetext'), /CRWV .*H100 .*H200/s);
  assert.equal(await chart.locator('[data-bar-focus]:not([visibility="hidden"])').count(), 2);
  await page.locator('[data-desk-mode="monitor"]').click();
  assert.equal(await chart.locator('[data-comparison-label-backing]').count(), 2);
  await chart.scrollIntoViewIfNeeded();
  const tooltip = page.locator('[data-gpu-tooltip]');
  // Check actual column centers on both sides of a weekend, not just the
  // synthetic target centers: those date cells have asymmetric widths.
  for (const weekday of [1, 5]) for (const layer of ['H100', 'H200']) {
    const target = await chart.locator(`[data-bar-hit="${layer}"]`).evaluateAll((nodes, weekday) => {
      const node = nodes.find(node => {
        const bar = node.__data__;
        return bar.index > 30 && bar.height > 8 && new Date(bar.date).getUTCDay() === weekday;
      });
      const bar = node.__data__;
      const p = new DOMPoint(bar.x + bar.width / 2, bar.y + bar.height / 2).matrixTransform(node.getScreenCTM());
      const date = new Date(bar.date);
      return { x: p.x, y: p.y, index: bar.index, value: bar.value - 100,
        date: `${String(date.getUTCDate()).padStart(2, '0')} ${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${date.getUTCFullYear()}` };
    }, weekday);
    await page.mouse.move(target.x, target.y);
    assert.equal(await tooltip.locator('[data-active="true"]').getAttribute('data-layer'), layer, 'visible bar selects its GPU');
    assert.equal(await tooltip.locator('time').textContent(), target.date);
    assert.equal(Number((await tooltip.locator(`[data-layer="${layer}"] strong`).textContent()).replace('−', '-').replace('%', '')), Number(target.value.toFixed(1)));
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), target.index);
    const box = await tooltip.boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - target.y) < box.height / 2, 'tooltip stays near the bar region');
    const stock = await chart.locator('.gpu-benchmark__point').evaluate(node => {
      const p = new DOMPoint(+node.getAttribute('cx'), +node.getAttribute('cy')).matrixTransform(node.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.mouse.move(stock.x, stock.y);
    assert.equal(await tooltip.locator('[data-active="true"]').count(), 0, 'stock inspection clears the active GPU row');
  }
  await page.locator('[data-gpu-range="7d"]').click();
  assert.equal(new URL(page.url()).searchParams.get('style'), 'bars');
  assert.doesNotMatch(await chart.innerHTML(), /NaN|Infinity/);
  const desk = createSharedDesk({ name: 'Comparison', entries: [{ cardId: 'equities', name: 'CoreWeave + compute', state }] });
  await open(page, `/?view=gallery#desk=${encodeSharedDesk(desk)}`);
  assert.equal(await page.locator('[data-card-gallery-grid] [data-comparison-bars]').count(), 2);
  assert.equal(await page.locator('[data-card-gallery-grid] [data-comparison-label-backing]').count(), 0);
  await open(page, '/?card=equities&view=craft&symbol=NVDA&scale=index&style=bars');
  await page.locator('[data-card-compare-toggle]').click();
  assert.equal(await page.locator('[data-card-option="style"]').first().isVisible(), false);
  assert.equal(await chart.locator('[data-comparison-bars]').count(), 0);
});
