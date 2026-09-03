const TITLE_X = 48;
const HEADER_Y = 80;
const CONTEXT_X = 1152;

export function viewArtifactHeaderLayout(title, { compact = false } = {}) {
  const safeTitle = String(title || "").slice(0, 48);
  return Object.freeze({
    title: safeTitle,
    titleX: TITLE_X,
    titleY: HEADER_Y,
    titleSize: compact
      ? safeTitle.length > 20
        ? 48
        : 60
      : safeTitle.length > 24
        ? 30
        : 36,
    contextX: CONTEXT_X,
    contextY: HEADER_Y,
    contextSize: compact ? 36 : 30,
    headlineX: TITLE_X,
    headlineY: compact ? 192 : 160,
    headlineSize: compact ? 104 : 82,
    plotTop: compact ? 128 : 96,
    washHeight: compact ? 204 : 158,
    washOpacity: 0.58,
  });
}

export function viewArtifactHeaderMarkup({
  title,
  context,
  headline = "",
  colors,
  compact = false,
  overlap = false,
}) {
  const layout = viewArtifactHeaderLayout(title, { compact });
  const line = colors?.line || "#315f82";
  const paper = colors?.paper || "#ffffff";
  const washMarkup = overlap
    ? `<rect width="1200" height="${layout.washHeight}" fill="${paper}"
      fill-opacity="${layout.washOpacity}"/>`
    : "";
  const headlineMarkup = headline
    ? `<text x="${layout.headlineX}" y="${layout.headlineY}" fill="${line}"
      stroke="${paper}" stroke-width="10" stroke-opacity="0.78" stroke-linejoin="round"
      font-family="Geist, Avenir Next, sans-serif" font-size="${layout.headlineSize}"
      font-weight="500" letter-spacing="-2"
      style="paint-order:stroke fill;font-variant-numeric:tabular-nums">${escapeXml(headline)}</text>`
    : "";

  return `<g data-view-artifact-header="" pointer-events="none">
    ${washMarkup}
    <text x="${layout.titleX}" y="${layout.titleY}" fill="${line}"
      font-family="Geist, Avenir Next, sans-serif" font-size="${layout.titleSize}"
      font-weight="600" letter-spacing="0.25" fill-opacity="0.88">${escapeXml(layout.title)}</text>
    <text x="${layout.contextX}" y="${layout.contextY}" fill="${line}"
      font-family="Geist Mono, monospace" font-size="${layout.contextSize}"
      font-weight="600" text-anchor="end" letter-spacing="1"
      fill-opacity="0.68">${escapeXml(context)}</text>
    ${headlineMarkup}
  </g>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
