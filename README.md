# Desk

Desk is a standalone, interactive GPU Price Index for comparing frozen hourly
price history across H100, H200, B200, and B300 accelerators.

Website: <https://desk.adamsioud.com>

## Product model

Desk treats cards, data, actions, and settings as addressable resources. The
resource layer stays stable and path-like; HTML is the presentation layer that
gives those resources hierarchy, interaction, color, motion, and context.

Press **Command G** to search that resource index. Current entries use paths
such as `/cards/gpu-price-index` and `/settings/palette/linen`. New card modules
can register more commands without changing the search interface.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Open <http://localhost:4173>.

## Project shape

- `index.html` contains the card's semantic markup.
- `src/` contains the interaction, chart, sharing, and transition modules.
- `src/command-palette.js` contains the reusable command registry and search UI.
- `styles/` contains the extracted card styles and the minimal white-page shell.
- `api/dashboard-snapshots/` contains frozen sample market data.

The demo starts in the interactive chart view. Use **Share** to open the share artifact and copy its link.

Desk reads only the snapshots in this repository. It makes no runtime requests
to the website it was extracted from, and copied links preserve the selected
GPU and date range on the current Desk origin.
