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
AMD and TSM (the US-listed depositary share). Cards support **7D, 90D and 1Y**,
daily demo prices or percentage change, comparisons, saved views and desk sharing.
**1Y** is the default and supports drag-to-zoom. Older equities links and saved
views using ALL open as 1Y.

To compare stocks with GPU rental prices, choose **Compare with compute** in
Desk, or add **H100 / H200** under **Craft → Data → Compute**. Mixed views use
percentage change from the same shared starting day. The chart keeps only dates
present in every selected series and uses the last recorded GPU price per UTC
day. Hover shows the original dollars per share or GPU hour; the source panel
identifies the current GPU demo history. Saved views, pins and shared desks keep
the comparison settings.

The current GPU sample covers about 90 days. A 1Y stock/GPU comparison can only
show their shared dates, which are shown at the ends of the chart; it does not
invent the missing months of GPU history.

Equity history is bundled, deterministic synthetic data for exploring Desk—not
observed market prices or live quotes. No account, API key, provider requests or
scheduled equity refresh is needed. The chart identifies these values as demo
data in USD per share.

`npm run generate:equities` regenerates `data/equities-source.json`, and
`npm run build:data` produces the browser runtime. Public builds accept only the
explicit demo runtime; raw source files and retired provider exports are not
copied to the site. Equities are not exported through the Desk API.

## Sandbox cost

The **Sandbox** catalog has a latest-run distribution and cost history lines
for Novita, Daytona VM, Blaxel, E2B, Modal VM and Modal gVisor. Both are available
in Craft, Monitor, focused cards, pins and shared desks. The chart carries over
the original AdamSioud Sandbox card's distribution marks, stacked history lanes
and anchored inspection, adapted to Desk's colors and sizing. Focus and Monitor
keep the row labels and prices, without the original top summary tiles. Gallery
uses unlabeled, full-width graphics and one cost headline: the unweighted mean
of the displayed providers' medians (their last available batch medians for history).

This is the archived **6 August 2026** snapshot from
[HPC Sandbox Benchmarks](https://github.com/starslingdev/hpc-sandbox-benchmarks),
not a live price feed. Costs are estimated CPU/memory charges per completed
benchmark job, displayed in cents. Latest-run whiskers show min/max, the bar
shows P25–P75, and the tick shows the median of 12 replicates.

Latest rows show replicate medians. History lanes are sorted by their latest
daily batch median, shown at the right of each lane. Their
monotone lines connect recorded observations without adding samples; null values
break the line. Each provider has an independent vertical scale. The narrow
shading beneath each history line is decorative, not an uncertainty interval.
Methodology varies across runs and is retained in the source data. Costs exclude
startup, teardown, retries, storage, networking, plan fees and credits.

The compact source is `api/dashboard-snapshots/sandbox-cost.json`; `npm run build:data`
validates and generates `data/sandbox-cost.json`. No external API calls are needed.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Open <http://localhost:4173>.
