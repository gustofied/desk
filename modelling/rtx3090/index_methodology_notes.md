# Index construction and the historical baseline

Methodology references for the [GPU rental price study](article.md), September 2026.

## Published compute methodologies

| Publisher | Construction | Unpublished details |
| --- | --- | --- |
| Silicon Data | Normalize to USD per GPU-hour; review flagged records; adjust contract and hardware differences; average within providers, then weight providers. The pricing model is recalibrated weekly. | The adjustment model and exact provider weights. |
| Ornn | GPU-unit-weighted winsorized mean within each one-hour calculation window; bounds come from that window’s weighted distribution. No temporal smoothing. | The winsorization percentile and complete hardware qualification thresholds are confidential. |
| Compute Desk / General Index | Compute Desk contributes deal data; GX calculates and administers daily benchmarks. The announcement includes live quotes and completed transactions. | Exact weighting, outlier treatment and adjustment coefficients are not established by the cited announcement. |

Sources: [Silicon Data PDF, updated August 27](https://www.silicondata.com/documents/silicon-data-index-methodology.pdf); [Ornn methodology, published July 24](https://data.ornn.com/methodology); [GX announcement, August 17](https://www.general-index.com/post/compute-desks-indexes-are-now-regulated).

Compute Desk describes [reserved compute](https://www.compute-desk.com/compute-trader) and [US one-year GPU rentals](https://www.compute-desk.com/). Product definitions vary by series; [GX factsheets](https://docs.g-x.co/#index-methodology-factsheets) specify their calculations.

Ornn specifies hourly construction and daily settlement. Winsorization limits extreme prices within a calculation window. The cap in this study limits how quickly the baseline updates over time.

## Price index

Price indices require a defined product, consistent units, explicit weights and rules for missing observations. This study uses the Jevons geometric mean described by the [ONS](https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/traditionaldataaggregatesinconsumerprices), matching recorded configurations across days.

The daily index is:

`I[t] = I[t−1] × exp(mean(log(p[i,t] / p[i,t−1])))`

Only configurations appearing on both adjacent calendar days contribute to that link. Each contributes equally; neither GPU quantities nor executed transaction volumes are available. The result measures relative changes in posted rental quotes. At least 20 machines and 10 sellers are required per link.

Daily chaining can accumulate effects from changing membership. ONS discusses this for [web-scraped prices](https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/conditionsanddiseases/methodologies/onlineweeklypricechangesmethodology). Here, a direct April comparison gives 287.9 on May 30, versus 240.1 in the daily chain. The peak depends on the method.

## Baseline specification and interpretation

[NIST’s EWMA explanation](https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc324.htm) provides the standard recursive smoothing idea. Our capped log update and historical residual limits are study-specific choices:

`error[t] = log(I[t]) − level[t−1]`

`level[t] = level[t−1] + alpha × clip(error[t], −cap, cap)`

The plotted baseline is `exp(level[t−1])`. March sets the cap; April selects the seven-day smoothing half-life and residual limits. The maximum upward update is `100 × (exp(alpha × cap) − 1) = 0.2558%`. That constrains adaptation, not prices. Once the cap binds, seven days is not the effective time to absorb a large shock.

A reference fitted on the event itself can absorb the departure being investigated. Here calibration ends before May, although the broader study remains retrospective. A persistent new price regime would eventually require an explicit reassessment of the reference. The baseline estimates recent usual behaviour, not an economically correct price or what prices would have been without a particular workload.

## Results

On May 30 the index is 240.1 and the baseline 105.4: a 128% departure. Of 40 eligible sellers, 39 are above +10% and 34 above +100% relative to April. The [notebook](price_model.ipynb) produces the calculations and seller comparisons.
