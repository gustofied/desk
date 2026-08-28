const DESK_CARD = {
  id: "gpu-index",
  hash: "gpu-benchmark-card",
  stateParams: ["gpu", "range", "palette"],
};

export function cardPermalink(cardId, stateParams = {}) {
  const isDeskCard = cardId === DESK_CARD.id;
  const url = new URL(window.location.href);
  url.search = "";
  if (!isDeskCard) return url;
  url.searchParams.set("card", DESK_CARD.id);
  url.searchParams.set("view", "detail");
  for (const [name, value] of Object.entries(stateParams)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(name, value);
    }
  }
  url.hash = DESK_CARD.hash;
  return url;
}

export function normalizeLegacyCardPresentation() {
  const params = new URL(window.location.href).searchParams;
  if (params.get("present") !== "card") return;

  if (params.get("card") !== DESK_CARD.id) return;

  const articleUrl = new URL(window.location.href);
  articleUrl.search = "";
  articleUrl.searchParams.set("card", DESK_CARD.id);
  articleUrl.searchParams.set("view", "detail");
  for (const name of DESK_CARD.stateParams) {
    const value = params.get(name);
    if (value) articleUrl.searchParams.set(name, value);
  }
  articleUrl.hash = DESK_CARD.hash;
  window.history.replaceState({}, "", articleUrl);
}

normalizeLegacyCardPresentation();

export function normalizeCardHash() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("card") !== DESK_CARD.id) return;
  if (url.hash === `#${DESK_CARD.hash}`) return;

  url.hash = DESK_CARD.hash;
  window.history.replaceState({}, "", url);
  window.requestAnimationFrame(() => {
    document.getElementById(DESK_CARD.hash)?.scrollIntoView({ block: "start" });
  });
}

normalizeCardHash();
