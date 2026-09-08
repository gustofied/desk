// Slide between Craft panels inside the fixed card; keep workspace motion separate.
// The outgoing copy is visual only; real controls work from the first frame.
export function createCraftMotion({ host, frame, reducedMotion }) {
  let incoming = null;
  let outgoing = null;
  let frameMotion = null;
  let frameBefore = null;
  let snapshot = null;
  let serial = 0;

  function cancel() {
    incoming?.cancel();
    outgoing?.cancel();
    frameMotion?.cancel();
    frameMotion = frameBefore = null;
    incoming = outgoing = null;
    snapshot?.remove();
    snapshot = null;
  }

  function prepare(content, keyboard = false) {
    if (keyboard || reducedMotion()) {
      cancel();
      return null;
    }
    // Capture the visible perimeter before layout changes. Content can dissolve
    // smoothly while its parent still jumps when the Craft toolbar is inserted.
    frameBefore = frame?.checkVisibility() ? frame.getBoundingClientRect() : null;
    frameMotion?.cancel();
    frameMotion = null;
    // Repeated clicks keep the outgoing layer and continue the movement
    // from its current position. The new content never becomes transparent.
    const running = incoming && (incoming.pending || incoming.playState === 'running');
    const current = running ? getComputedStyle(incoming.effect.target) : null;
    const from = current ? { transform: current.transform } : null;
    incoming?.cancel();
    incoming = null;
    const continuing = Boolean(snapshot);
    if (!snapshot && content?.checkVisibility() && host.checkVisibility()) {
      const bounds = content.getBoundingClientRect();
      const parent = host.getBoundingClientRect();
      snapshot = document.createElement('div');
      snapshot.className = 'desk-craft-outgoing';
      snapshot.dataset.craftTransitionOutgoing = '';
      snapshot.setAttribute('aria-hidden', 'true');
      snapshot.inert = true;
      // Include the surface, not just its marks. Fading two transparent content
      // layers independently exposes the empty card and reads as a blink.
      for (let surface = host; surface; surface = surface.parentElement) {
        const color = getComputedStyle(surface).backgroundColor;
        if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
          snapshot.style.backgroundColor = color;
          break;
        }
      }
      const copy = content.cloneNode(true);
      const elements = [copy, ...copy.querySelectorAll('*')];
      const prefix = `craft-outgoing-${++serial}-`;
      const ids = new Map(elements.filter(node => node.id).map(node => [node.id, prefix + node.id]));
      for (const node of elements) {
        for (const attribute of [...node.attributes]) {
          // No live selectors, duplicate IDs, focus targets, or label references.
          if (attribute.name.startsWith('data-') || attribute.name.startsWith('aria-') ||
              ['tabindex', 'autofocus', 'for'].includes(attribute.name)) {
            node.removeAttribute(attribute.name);
            continue;
          }
          if (attribute.name === 'id') {
            node.id = ids.get(attribute.value);
            continue;
          }
          const value = attribute.value.replace(/url\((['"]?)#([^)'"\s]+)\1\)/g,
            (match, quote, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
          if (attribute.localName === 'href' && value.startsWith('#') && ids.has(value.slice(1))) {
            node.setAttribute(attribute.name, `#${ids.get(value.slice(1))}`);
          } else if (value !== attribute.value) node.setAttribute(attribute.name, value);
        }
      }
      Object.assign(copy.style, {
        position: 'absolute', margin: '0',
        left: `${bounds.left - parent.left}px`, top: `${bounds.top - parent.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`,
        opacity: '1', transform: 'none',
      });
      snapshot.append(copy);
      host.append(snapshot);
      copy.scrollTop = content.scrollTop;
    }
    return continuing ? from : null;
  }

  function play(content, { keyboard = false, direction = 1, from = null, switchPanel = false } = {}) {
    if (keyboard || reducedMotion() || !content?.animate) {
      cancel();
      return;
    }
    if (frameBefore && frame?.checkVisibility()) {
      const after = frame.getBoundingClientRect();
      const before = frameBefore;
      frameBefore = null;
      if (after.width && after.height && ['x', 'y', 'width', 'height'].some(
        key => Math.abs(before[key] - after[key]) > 0.5,
      )) {
        const animation = frame.animate([
          {
            transformOrigin: '0 0',
            transform: `translate(${before.x - after.x}px, ${before.y - after.y}px) scale(${before.width / after.width}, ${before.height / after.height})`,
          },
          { transformOrigin: '0 0', transform: 'none' },
        ], { id: 'desk-craft-frame', duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
        frameMotion = animation;
        animation.finished.then(() => {
          if (frameMotion === animation) frameMotion = null;
        }, () => {});
      }
    }
    incoming?.cancel();
    const push = switchPanel && Boolean(snapshot);
    const distance = direction * host.clientWidth;
    // Type selection is a step into the editor; Views is the reverse step.
    // Keep both panels opaque and move them through the stationary card.
    let outgoingFrom = 'translateX(0)';
    if (push && outgoing) {
      outgoingFrom = getComputedStyle(snapshot).transform;
      outgoing.cancel();
      outgoing = null;
    }
    if (snapshot && !outgoing) {
      const old = snapshot;
      outgoing = old.animate(push ? [
        { opacity: 1, transform: outgoingFrom },
        { opacity: 1, transform: `translateX(${-distance}px)` },
      ] : [
        { opacity: 1 },
        { opacity: 0 },
      ], { id: 'desk-craft-outgoing', duration: push ? 280 : 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'both' });
      outgoing.finished.then(() => {
        old.remove();
        if (snapshot === old) {
          snapshot = null;
          outgoing = null;
        }
      }, () => {});
    }
    const animation = content.animate([
      { opacity: 1, transform: from?.transform || (push ? `translateX(${distance}px)` : `translateY(${direction * 2}px)`) },
      { opacity: 1, transform: 'translate(0)' },
    ], { id: 'desk-craft-content', duration: push ? 280 : 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    incoming = animation;
    animation.finished.then(() => {
      if (incoming === animation) incoming = null;
    }, () => {});
  }

  function prepareFrame(bounds) {
    cancel();
    frameBefore = bounds;
  }

  return { prepare, prepareFrame, play, cancel };
}
