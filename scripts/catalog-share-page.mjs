import { PUBLISHED_CARD_VERSION, SITE_ORIGIN } from "../src/card-registry.js";

// Metadata is present in the first HTML response; unfurlers need no JavaScript.
export function renderCatalogSharePage(artifact, pageHref, imageHref, imageRevision) {
  const destination = new URL(artifact.destination);
  if (destination.origin !== SITE_ORIGIN || destination.pathname !== "/") {
    throw new TypeError("A Desk chart destination is required");
  }
  for (const path of [pageHref, imageHref]) {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/.test(path) || new URL(path, SITE_ORIGIN).origin !== SITE_ORIGIN) {
      throw new TypeError("A local preview path is required");
    }
  }
  const target = `${destination.pathname}${destination.search}${destination.hash}`;
  const pageUrl = new URL(pageHref, SITE_ORIGIN);
  pageUrl.searchParams.set("v", `${PUBLISHED_CARD_VERSION}-${artifact.revision}`);
  const imageUrl = new URL(imageHref, SITE_ORIGIN);
  imageUrl.searchParams.set("v", imageRevision);
  const background = artifact.state.theme === "dark" ? "#1c1c1c" : "#fafafa";
  const foreground = artifact.state.theme === "dark" ? "#efefe8" : "#172630";
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const title = escape(artifact.title);
  const description = escape(artifact.description);
  const alt = escape(artifact.imageAlt);
  const image = escape(imageUrl.href);
  const canonical = escape(pageUrl.href);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${description}">
    <meta name="theme-color" content="${background}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Desk">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta property="og:image:secure_url" content="${image}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${alt}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">
    <meta name="twitter:image:alt" content="${alt}">
    <title>${title} | Desk</title>
    <script>window.location.replace(new URL(${JSON.stringify(target).replaceAll("<", "\\u003c")}, window.location.origin));</script>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${background}; color: ${foreground}; font: 500 16px/24px Geist, system-ui, sans-serif; }
      a { color: inherit; text-underline-offset: 0.2em; }
    </style>
  </head>
  <body><a href="${escape(target)}">Open view</a></body>
</html>
`;
}
