const CARD_PRESENTATIONS = {
  "gpu-index": {
    hash: "gpu-benchmark-card",
    stateParams: ["gpu", "range"],
  },
  "prime-offer-shelf": {
    hash: "prime-offer-shelf-card",
    stateParams: ["primeGpu", "primeRange"],
  },
  "sandbox-cost": {
    hash: "sandbox-benchmark-card",
    stateParams: ["sandboxRange"],
  },
};

export function cardPermalink(cardId, stateParams = {}) {
  const presentation = CARD_PRESENTATIONS[cardId];
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("card", cardId);
  url.searchParams.set("view", "detail");
  for (const [name, value] of Object.entries(stateParams)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(name, value);
    }
  }
  url.hash = presentation?.hash || "";
  return url;
}

export function normalizeLegacyCardPresentation() {
  const params = new URL(window.location.href).searchParams;
  if (params.get("present") !== "card") return;

  const cardId = params.get("card");
  const presentation = CARD_PRESENTATIONS[cardId];
  if (!presentation) return;

  const articleUrl = new URL(window.location.href);
  articleUrl.search = "";
  articleUrl.searchParams.set("card", cardId);
  articleUrl.searchParams.set("view", "detail");
  for (const name of presentation.stateParams) {
    const value = params.get(name);
    if (value) articleUrl.searchParams.set(name, value);
  }
  articleUrl.hash = presentation.hash;
  window.history.replaceState({}, "", articleUrl);
}

normalizeLegacyCardPresentation();

export function normalizeCardHash({ forceScroll = false } = {}) {
  const url = new URL(window.location.href);
  const presentation = CARD_PRESENTATIONS[url.searchParams.get("card")];
  if (!presentation) return;

  const requestedHash = url.hash.slice(1);
  const knownCardHash = Object.values(CARD_PRESENTATIONS).some(
    (candidate) => candidate.hash === requestedHash,
  );
  const articleTarget =
    requestedHash &&
    !knownCardHash &&
    document.getElementById(requestedHash);

  // An explicit article section wins over stale card presentation state. This
  // also covers links opened in a new tab, where the normal click handler does
  // not get a chance to remove the temporary card query parameters.
  if (articleTarget) {
    url.searchParams.delete("card");
    url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
    return;
  }

  const mismatchedHash = url.hash !== `#${presentation.hash}`;
  if (mismatchedHash) {
    // A copied link can retain the previous card's fragment while its query
    // selects another card. The selected card owns the landing position.
    url.hash = presentation.hash;
    window.history.replaceState({}, "", url);
  }
  if (!mismatchedHash && !forceScroll) return;

  window.requestAnimationFrame(() => {
    document.getElementById(presentation.hash)?.scrollIntoView({ block: "start" });
  });
}

normalizeCardHash();

let cardLandingActive = Boolean(resolveCardLandingTarget());
let cardLandingFrame = 0;
let cardLandingTimeout = 0;
let cardViewportTimer = 0;
let cardViewportWidth = getCardViewportWidth();

if (cardLandingActive) {
  armCardLandingCorrection();
}

function resolveCardLandingTarget() {
  const url = new URL(window.location.href);
  const selected = CARD_PRESENTATIONS[url.searchParams.get("card")];
  const hash = selected?.hash || url.hash.slice(1);
  if (!hash) return null;

  const knownHash = Object.values(CARD_PRESENTATIONS).some(
    (presentation) => presentation.hash === hash,
  );
  return knownHash ? document.getElementById(hash) : null;
}

function armCardLandingCorrection() {
  cardLandingActive = Boolean(resolveCardLandingTarget());
  if (!cardLandingActive) return;

  window.clearTimeout(cardLandingTimeout);
  cardLandingTimeout = window.setTimeout(() => {
    cardLandingActive = false;
  }, 5000);
  scheduleCardLandingCorrection();
}

function scheduleCardLandingCorrection() {
  if (!cardLandingActive) return;
  window.cancelAnimationFrame(cardLandingFrame);
  cardLandingFrame = window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!cardLandingActive) return;
      resolveCardLandingTarget()?.scrollIntoView({ block: "start" });
    });
  });
}

function stopCardLandingCorrection() {
  cardLandingActive = false;
  window.clearTimeout(cardLandingTimeout);
  window.clearTimeout(cardViewportTimer);
  window.cancelAnimationFrame(cardLandingFrame);
}

function correctCardAfterViewportChange() {
  const nextViewportWidth = getCardViewportWidth();
  const widthChanged = Math.abs(nextViewportWidth - cardViewportWidth) > 1;
  cardViewportWidth = nextViewportWidth;

  // Mobile browser chrome changes the visual viewport height during ordinary
  // scrolling. That must not pull a previously opened card back into view.
  // Only correct a genuine width change while the initial landing is active.
  if (!cardLandingActive || !widthChanged) return;

  window.clearTimeout(cardViewportTimer);
  cardViewportTimer = window.setTimeout(() => {
    if (!cardLandingActive) return;
    const target = resolveCardLandingTarget();
    if (!target) return;

    const bounds = target.getBoundingClientRect();
    const nearby =
      bounds.bottom > -window.innerHeight * 0.5 &&
      bounds.top < window.innerHeight * 1.5;
    if (!nearby) return;

    target.scrollIntoView({ block: "start" });
  }, 90);
}

function getCardViewportWidth() {
  return window.visualViewport?.width || window.innerWidth;
}

// A card view is temporary presentation state, while an article hash records
// where the reader chose to go. When navigation leaves the selected card,
// remove only the presentation parameters so refresh and copied article links
// keep the reader at that section. Card-specific selections remain available.
function releaseCardPresentationForArticleNavigation() {
  const url = new URL(window.location.href);
  const presentation = CARD_PRESENTATIONS[url.searchParams.get("card")];
  if (!presentation || url.hash === `#${presentation.hash}`) return false;

  url.searchParams.delete("card");
  url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", url);
  stopCardLandingCorrection();
  return true;
}

function reconcileCardPresentationNavigation() {
  if (!releaseCardPresentationForArticleNavigation()) {
    normalizeCardHash();
  }
}

function navigateFromCardPresentation(event) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const anchor = event.target.closest?.('a[href^="#"]');
  if (!anchor || (anchor.target && anchor.target !== "_self")) return;

  const current = new URL(window.location.href);
  const presentation = CARD_PRESENTATIONS[current.searchParams.get("card")];
  const destination = new URL(anchor.href, current);
  if (
    !presentation ||
    !destination.hash ||
    destination.hash === `#${presentation.hash}`
  ) {
    return;
  }

  event.preventDefault();
  current.searchParams.delete("card");
  current.searchParams.delete("view");
  current.hash = destination.hash;
  window.history.pushState(window.history.state, "", current);
  stopCardLandingCorrection();
  document
    .getElementById(decodeURIComponent(destination.hash.slice(1)))
    ?.scrollIntoView({ block: "start" });
}

// The cards above a deep link fill asynchronously. Reassert the landing point
// as each one settles so their changing height cannot leave a sliced card at
// the top of the viewport. Stop as soon as the visitor starts navigating.
document.addEventListener("compute-card:ready", scheduleCardLandingCorrection);
for (const eventName of ["wheel", "touchstart", "pointerdown", "keydown"]) {
  window.addEventListener(eventName, stopCardLandingCorrection, {
    capture: true,
    passive: true,
    once: true,
  });
}

// A genuine width change can move an initial card landing. Height-only visual
// viewport changes are Safari's collapsing browser chrome and are ignored.
window.addEventListener("resize", correctCardAfterViewportChange, {
  passive: true,
});
window.visualViewport?.addEventListener(
  "resize",
  correctCardAfterViewportChange,
  { passive: true },
);

// Safari restores both the URL and scroll position from its back-forward
// cache. Keep a mismatched card/hash pair coherent, but let native history
// restoration retain the reader's position.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    reconcileCardPresentationNavigation();
  }
});
document.addEventListener("click", navigateFromCardPresentation);
window.addEventListener(
  "hashchange",
  releaseCardPresentationForArticleNavigation,
);
window.addEventListener("popstate", reconcileCardPresentationNavigation);
