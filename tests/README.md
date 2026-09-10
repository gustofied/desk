# Tests

`npm test` runs the focused state, chart and calculation checks.

After `npm run build`, run `npm run check:previews` to check colored share images, their links and older depth routes. CI runs both checks before deployment.

For browser smoke checks, serve the built site with `npm run dev`, then run `npm run test:browser`. The three checks cover rendering, range switching and shared desks.

One-time browser setup: `npm install --no-save --package-lock=false playwright` and `npx playwright install chromium`. An existing Playwright installation works too through the variables below.

Optional environment variables: `DESK_BASE_URL`, `DESK_PLAYWRIGHT_MODULE` (module path), `DESK_BROWSER_ENGINE` (chromium or webkit), `DESK_BROWSER_PATH` (browser executable).
