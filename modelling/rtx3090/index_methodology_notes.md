# Index construction and the historical baseline

Research checked September 24, 2026. These notes support the [article draft](/Users/adams/projects/desk/modelling/rtx3090/article.md); they do not change the model or its calculations.

## Published compute methodologies

| Publisher | Verified construction details | Public detail still missing |
| --- | --- | --- |
| Silicon Data | Normalize to USD per GPU-hour; review flagged records; adjust contract and hardware differences; average within providers, then weight providers. The pricing model is recalibrated weekly. | The proprietary adjustment model and exact provider weights. Do not describe these as equal or transaction-volume weights. |
| Ornn | GPU-unit-weighted winsorized mean within each one-hour calculation window; bounds come from that window’s weighted distribution. No temporal smoothing. | The winsorization percentile and complete hardware qualification thresholds are confidential. |
| Compute Desk / General Index | Compute Desk contributes deal data; GX calculates and administers daily benchmarks. GX’s announcement includes both live rental quotes and completed transactions. | I did not locate the compute-specific factsheet establishing exact weighting, outlier treatment and adjustment coefficients. Do not infer those rules from the general framework. |

Sources: [Silicon Data PDF, updated August 27](https://www.silicondata.com/documents/silicon-data-index-methodology.pdf); [Ornn methodology, published July 24](https://data.ornn.com/methodology); [GX announcement, August 17](https://www.general-index.com/post/compute-desks-indexes-are-now-regulated).

Compute Desk’s [product description](https://www.compute-desk.com/compute-trader) calls its contributed-transaction product a reserved compute index. Its [homepage](https://www.compute-desk.com/) labels individual GPU benchmarks as US one-year rentals. These descriptions should not be generalized into a claim that every series excludes quotes. [GX documentation](https://docs.g-x.co/#index-methodology-factsheets) places each series’ definitive calculation in its own factsheet.

Ornn’s public preview describes daily settlement, while its methodology specifies hourly construction. This note concerns construction, not the settlement convention. Winsorization limits extreme cross-sectional prices; it is not the historical update cap used in our model. Neither approach establishes immunity to manipulation.

## What transfers to this study

Conventional price-index construction requires a defined product, consistent units, explicit weighting and a rule for entry, exit and missing observations. The [ONS guide](https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/traditionaldataaggregatesinconsumerprices) documents the Jevons geometric mean and the importance of matching specifications and treating quality changes. Those principles motivate our matched configuration records; they do not validate this particular sample.

The daily index is:

`I[t] = I[t−1] × exp(mean(log(p[i,t] / p[i,t−1])))`

Only configurations appearing on both adjacent calendar days contribute to that link. Each contributes equally; neither GPU quantities nor executed transaction volumes are available. The result measures relative changes in posted rental quotes. At least 20 machines and 10 sellers are required per link.

Daily chaining can accumulate effects from changing membership. ONS discusses this problem for [web-scraped prices](https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/conditionsanddiseases/methodologies/onlineweeklypricechangesmethodology), where it used a multilateral method. Our existing direct-April comparison already shows sensitivity: May 30 is 287.9 under that alternative versus 240.1 in the daily chain. The article therefore treats the exact peak as method-dependent. No new estimator is introduced here.

## Baseline specification and interpretation

[NIST’s EWMA explanation](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm) provides the standard recursive smoothing idea. Our capped log update and historical residual limits are study-specific choices:

`error[t] = log(I[t]) − level[t−1]`

`level[t] = level[t−1] + alpha × clip(error[t], −cap, cap)`

The plotted baseline is `exp(level[t−1])`. March sets the cap; April selects the seven-day smoothing half-life and residual limits. The maximum upward update is `100 × (exp(alpha × cap) − 1) = 0.2558%`. That constrains adaptation, not prices. Once the cap binds, seven days is not the effective time to absorb a large shock.

A reference fitted on the event itself can absorb the departure being investigated. Here calibration ends before May, although the broader study remains retrospective. A persistent new price regime would eventually require an explicit reassessment of the reference. The baseline estimates recent usual behaviour, not an economically correct price or what prices would have been without a particular workload.

## Local evidence

The May 30 index and baseline are 240.1381 and 105.3605; their relative difference is 127.9205%. The seller audit confirms 39/40 above +10% and 34/40 above +100%. These calculations use [the existing model summary](/Users/adams/projects/desk/modelling/rtx3090/outputs/daily/summary.json) and [seller reference records](/Users/adams/projects/desk/modelling/rtx3090/outputs/daily/host_reference_audit.csv). The two article figures are existing Matplotlib exports.

The local Desk files `data/gpu-price-index.json` and `api/dashboard-snapshots/gpu-benchmark/h100.json` identify themselves as scenario/showcase data. They were not used as evidence about commercial indices or historical GPU prices.
