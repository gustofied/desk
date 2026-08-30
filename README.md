# Desk

Market data for compute desks.

[Open Desk](https://desk.adamsioud.com)

![Desk Catalog showing deal, price, snapshot, and market depth views](assets/showcase/desk-catalog-gallery.jpg)

Desk is a browser workspace for compute market views. Catalog organizes views,
Monitor opens one for inspection, and Craft composes and saves a view. Share
links preserve the view's data, range, chart mode, palette, and theme.

## Workspace

- **Catalog** arranges saved and preset views into named galleries that can be reordered.
- **Monitor** opens one view for hovering, zooming, and closer reading.
- **Craft** keeps that view in place while exposing its data and presentation
  controls.

## Included views

- Hourly H100, H200, B200, and B300 price history
- Current accelerator price comparison
- H100 market depth as a current capacity curve or depth history
- Deal 041 as a compact private market workflow
- Token Price Index as a comparison layer
- Price and index scales for comparisons across similar and mixed series
- Four palettes with light and dark themes

The included data is a deterministic product showcase. It is designed to
exercise the complete workspace and sharing system.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Open <http://localhost:4173>.

## Working with Desk

- Switch Catalogs from the Catalog segment and reorder views by dragging them.
- Open a view in Monitor, then move to Craft when its data or presentation
  needs changing.
- Save a Craft composition to the active Catalog. Saved views remain in the
  current browser.
- Use **Command G** to find views and controls, change the display, or copy an
  exact view link.
- Shared links keep the selected composition and use matching social artwork.
- Keyboard navigation, reduced motion, responsive layouts, and chart inspection
  are supported throughout.

## View system

[`src/card-registry.js`](src/card-registry.js) is the source of truth for view
metadata, renderers, data layers, ranges, palettes, defaults, and share paths.
The browser and preview build both read from it, so the page and shared artwork
stay aligned.

Saved views use a versioned `CardDocument` that keeps the renderer and every
registered state field together. Catalogs store references to those documents,
which lets the same view appear in multiple arrangements without copying its
data.

Internal `card` identifiers remain in filenames, URLs, and stored documents so
existing links and browser saves continue to work.

## Data and builds

Source records live under `api/dashboard-snapshots/`.

```bash
npm run check:data       # validate the included market run
npm run generate:data    # rebuild showcase histories and market depth
npm run build:data       # write compact browser data
npm run build:previews   # render exact social artwork
npm run build:site       # assemble the GitHub Pages artifact
```

`npm run refresh:data` validates a complete, non-regressing replacement set
before installing it. The `Refresh Desk market data` workflow is available for
manual refresh and can be scheduled when the configured source has a reliable
freshness guarantee.

The market depth scenario follows the availability ladder described in
[Feeling the Compute](https://www.adamsioud.com/exemplars/compute/feeling_the_compute.html):
capacity accumulates as the acceptable hourly price rises.

`npm run build` rebuilds browser data, exact previews, local fonts, and
`desk.js`. The generated Pages matrix is assembled without being committed to
Git history.

## Project map

- `index.html` contains the semantic workspace markup.
- `src/` contains the registry, state, view models, and renderers.
- `scripts/` validates data and builds previews and Pages output.
- `styles/` contains the workspace, view, control, and page styles.

Edit source files and run `npm run build`. `desk.js` is generated.
