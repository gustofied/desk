const focusableSelector = 'button, input, select, textarea, a[href], summary, [tabindex]';

export function createDataPanel({ panel, trigger, anchor, obstruction, onDismiss, reducedMotion }) {
  let opened = false;
  let animation;
  let openEvents;
  let resizeObserver;
  let positionFrame = 0;
  let pointerActive = false;

  const contains = target => target instanceof Node &&
    (panel.contains(target) || trigger.contains(target));

  function position() {
    if (!opened) return;
    const bounds = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const reserved = obstruction?.getBoundingClientRect().height || 0;
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.bottom}px`;
    panel.style.width = `${bounds.width}px`;
    panel.style.setProperty('--desk-data-panel-height', `${Math.max(0, Math.min(320, bottom - reserved - 12 - bounds.bottom))}px`);
  }

  function queuePosition() {
    if (positionFrame) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      position();
    });
  }

  function detach() {
    openEvents?.abort();
    openEvents = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    window.cancelAnimationFrame(positionFrame);
    positionFrame = 0;
    pointerActive = false;
  }

  function attach() {
    detach();
    openEvents = new AbortController();
    const { signal } = openEvents;
    document.addEventListener('pointerdown', () => { pointerActive = true; }, { capture: true, signal });
    document.addEventListener('pointerup', () => { pointerActive = false; }, { signal });
    document.addEventListener('pointercancel', () => { pointerActive = false; }, { signal });
    document.addEventListener('click', event => {
      // WebKit drops the outside control's click if hidePopover runs during
      // pointerdown. Dismiss once click dispatch has begun so that action runs.
      if (!contains(event.target)) onDismiss({ animate: true });
    }, { capture: true, signal });
    document.addEventListener('focusin', event => {
      // Pointer focus is handled by click; Safari can focus the containing article.
      if (!pointerActive && !contains(event.target)) onDismiss({ animate: false });
    }, { signal });
    document.addEventListener('keydown', event => {
      pointerActive = false;
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss({ animate: false, returnFocus: true });
    }, { signal });
    window.addEventListener('resize', queuePosition, { signal });
    document.addEventListener('scroll', queuePosition, { capture: true, passive: true, signal });
    window.visualViewport?.addEventListener('resize', queuePosition, { signal });
    window.visualViewport?.addEventListener('scroll', queuePosition, { passive: true, signal });
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(queuePosition);
      resizeObserver.observe(anchor);
      if (obstruction) resizeObserver.observe(obstruction);
    }
  }

  function focusFirst() {
    const target = Array.from(panel.querySelectorAll(focusableSelector)).find(element =>
      !element.matches(':disabled') && element.tabIndex >= 0 &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    (target || panel).focus({ preventScroll: true });
  }

  function hide() {
    if (panel.matches(':popover-open')) panel.hidePopover();
    panel.hidden = true;
  }

  function setOpen(next, { moveFocus = false, animate = false } = {}) {
    const wasVisible = !panel.hidden;
    const current = wasVisible ? getComputedStyle(panel) : null;
    const from = {
      opacity: current?.opacity || '0',
      transform: current?.transform || 'translateY(-4px)',
    };
    animation?.cancel();
    animation = null;
    const changed = opened !== next;
    opened = next;

    if (next) {
      panel.hidden = false;
      panel.inert = false;
      position();
      if (!panel.matches(':popover-open')) panel.showPopover();
      if (changed) {
        panel.scrollTop = 0;
        attach();
      }
      if (moveFocus) focusFirst();
    } else {
      detach();
      // Only Escape restores the trigger. Native popover dismissal would otherwise
      // restore it when a pointer dismisses a panel containing the focused input.
      if (panel.contains(document.activeElement)) document.activeElement.blur();
      panel.inert = true;
    }

    if (!animate || reducedMotion() || (!next && !wasVisible)) {
      if (!next) hide();
      return;
    }
    animation = panel.animate([
      from,
      { opacity: next ? 1 : 0, transform: next ? 'translateY(0)' : 'translateY(-4px)' },
    ], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    const activeAnimation = animation;
    animation.finished.then(() => {
      if (animation !== activeAnimation) return;
      animation = null;
      if (!opened) hide();
    }).catch(() => {});
  }

  return { setOpen };
}
