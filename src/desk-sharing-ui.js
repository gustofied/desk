import { getCardDefinition } from "./card-registry.js";
import { createSharedDesk, sharedDeskUrl } from "./shared-desk.js";

// A share is a configuration snapshot. Opening or copying its link never saves
// views in the recipient's browser; that is a separate, explicit action.
export function createDeskSharing({ dialog, errorNotice, getDesk, copyText, returnFocus }) {
  const form = dialog.querySelector("form");
  const name = dialog.querySelector("[data-desk-share-name]");
  const includePrivate = dialog.querySelector("[data-desk-share-private]");
  const privacy = dialog.querySelector("[data-desk-share-privacy]");
  const count = dialog.querySelector("[data-desk-share-count]");
  const list = dialog.querySelector("[data-desk-share-views]");
  const error = dialog.querySelector("[data-desk-share-error]");
  const link = dialog.querySelector("[data-desk-share-link]");
  const linkField = dialog.querySelector("[data-desk-share-link-field]");
  const submit = dialog.querySelector("[data-desk-share-submit]");
  let draft = null;
  let revision = 0;

  function refresh() {
    revision += 1;
    error.textContent = "";
    linkField.hidden = true;
    link.value = "";
    name.removeAttribute("aria-invalid");
    const entries = (draft?.entries || []).filter((entry) =>
      includePrivate.checked || getCardDefinition(entry.cardId).renderer !== "deal",
    );
    count.textContent = `${entries.length} ${entries.length === 1 ? "view" : "views"}`;
    list.replaceChildren(...entries.map((entry) => {
      const item = document.createElement("li");
      item.textContent = entry.name;
      return item;
    }));
    submit.disabled = entries.length === 0;
    if (!entries.length) error.textContent = privacy.hidden
      ? "This desk has no views to share."
      : "Include Quote and Deal to share this desk.";
  }

  name.addEventListener("input", refresh);
  includePrivate.addEventListener("change", refresh);
  dialog.querySelector("[data-desk-share-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    revision += 1;
    returnFocus?.focus({ preventScroll: true });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.textContent = "";
    let url;
    try {
      const snapshot = createSharedDesk({ ...draft, name: name.value }, {
        includePrivate: includePrivate.checked,
      });
      url = sharedDeskUrl(snapshot, window.location.href);
    } catch (cause) {
      error.textContent = cause.message || "Could not create this link.";
      if (!name.value.trim()) {
        name.setAttribute("aria-invalid", "true");
        name.focus();
      }
      return;
    }
    const attempt = ++revision;
    // Keep a selectable link available even if the browser denies clipboard.
    link.value = url;
    linkField.hidden = false;
    const copied = await copyText(url).catch(() => false);
    if (attempt !== revision || !dialog.open) return;
    error.textContent = copied ? "Link copied" : "Select and copy the link below.";
    if (!copied) { link.focus(); link.select(); }
  });
  link.addEventListener("click", () => link.select());

  return {
    open() {
      draft = getDesk();
      name.value = draft.name;
      includePrivate.checked = false;
      privacy.hidden = !draft.entries.some((entry) => getCardDefinition(entry.cardId).renderer === "deal");
      refresh();
      dialog.showModal();
      name.focus();
      name.select();
    },
    sync({ error: message = null } = {}) {
      errorNotice.hidden = !message;
      errorNotice.textContent = message || "";
    },
  };
}
