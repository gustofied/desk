# Desk

A standalone workspace for the Compute Bazaar GPU Price Index card.

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
- `styles/` contains the extracted card styles and the minimal white-page shell.
- `api/dashboard-snapshots/` contains frozen sample market data.

The demo starts in the interactive chart view. Use **Card** to see its cover and **Share** to see the share artifact.
