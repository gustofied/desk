# Desk

![Desk Overview catalog](assets/showcase/desk-catalog-header.png)

The workspace for compute desks.

Desk is the workspace where you explore compute market data, create market
views, monitor and share. Built for anyone building or running a compute desk.

[Open Desk](https://desk.adamsioud.com/) to try it out<br>
[read the article](https://www.adamsioud.com/exemplars/compute-desk/your_compute_desk.html) to learn more about Desk.

The idea behind Desk is that you can compose what you want to see: compute market data, power data, your deals, or anything else relevant to your work. It is a workspace with the basic pieces to build your own compute desk. A simple Bloomberg-esque terminal, just for compute, just sleeker.

See [The Compute Bazaar](https://github.com/gustofied/the-compute-bazaar) for
my wider work on compute markets.

## Share a desk

Select a catalog, open Desk with **Cmd/Ctrl-G**, and choose **Share desk**.
The link includes the selected catalog's view names, order, chart settings and
appearance. Quote and Deal views are excluded unless explicitly included.

Recipients can browse the shared collection without replacing their own views,
then choose **Save a copy** to keep an independent catalog in their browser.
**Copy view link** still shares only the current chart.

Links contain configuration, not frozen market data or live collaboration.
They need no account or backend: the snapshot is encoded in the URL fragment,
not encrypted, and readable by anyone with the link. There is no link revocation.
Up to 32 views are supported; oversized links are rejected rather than truncated.

## Equities

The **Equities** catalog includes MSFT, AMZN, GOOGL, ORCL, CRWV, NBIS, NVDA,
AMD and TSM (the US-listed depositary share). Cards support **7D, 90D, 1Y,
ALL**, adjusted close or percentage change, comparisons, saved views and desk
sharing. ALL means the history currently loaded, initially one year.

Connect an [EODHD historical-data account](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes)
by setting `EODHD_API_TOKEN` securely in your environment, then run:

```bash
npm run refresh:equities
```

One refresh uses nine calls and replaces the cache only after all nine histories
validate. Prices are split- and dividend-adjusted daily closes in USD per share,
not live quotes. Non-trading days and pre-listing history are not fabricated.
Without a key, the catalog shows an explicit unconnected state.

The private source cache lives in `.cache/equities-source.json`; source credentials
never enter browser code. Charts read the generated `data/equities.json` runtime;
equities are not exported through the Desk API. The runtime is git-ignored. Public
deployment is blocked while the loaded feed's public-display rights are unconfirmed:
API access alone is not a redistribution license. See the
[provider's terms](https://eodhd.com/financial-apis/terms-conditions).

### Daily Pages refresh (opt-in)

The Pages workflow is prepared to refresh equities once daily at **06:17 UTC**.
It stays disabled until the repository variable `EQUITIES_PUBLIC_DISPLAY_RIGHTS`
is exactly `confirmed`. Set that variable only after obtaining permission to
display the provider's prices publicly, and configure the repository Actions
secret `EODHD_API_TOKEN`. These are deployment setup steps, not settings the app
changes automatically. The non-secret rights variable is an explicit build-time
override; it does not change the original provider snapshot or grant a license.

Only the first attempt of the scheduled run can fetch: nine requests, no retries.
A validated cache retrieved on the same UTC date skips the calls. Pushes, manual
deployments and reruns never fetch; they reuse the latest validated cache and
report its actual retrieval and closing dates. If no cache exists while enabled,
those deployments fail and wait for the next daily scheduled run. A failed
refresh stops before deployment, leaving the last deployed site intact. Other
clients using the same provider account still share its daily quota.

Successful snapshots are stored under immutable daily GitHub Actions cache keys,
with only `.cache/equities-source.json` cached. Stock history is not committed to
Git, and the token is passed only to the refresh step, never to the build or
browser. Actions caches are **not confidential**: fork pull requests can access
default-branch caches, so this workflow caches observations only after public
display rights are confirmed. Caches can also expire or be evicted; they are not
a permanent archive. See [GitHub's caching documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

Pages runs are serialized with queued pending runs so a concurrent push cannot
cancel a waiting daily refresh. GitHub schedules may still be delayed or dropped,
and schedules in public repositories are disabled after 60 days without activity;
this is a daily best-effort refresh, not a guaranteed market-data service. See
[GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Run locally

```bash
npm install
npm run build
npm run dev
```

Open <http://localhost:4173>.
