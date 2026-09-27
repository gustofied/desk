# GPU repricing: concentrated or widespread?

RTX 3090 rental quotes on Vast.ai, February–August 2026.

[Executed notebook](price_model.ipynb) / [Report](price_model.html) / [Editable source](price_model.py)

[Published exemplar](https://www.adamsioud.com/exemplars/gpu-prices/) / [Industry index methodology notes](index_methodology_notes.md)

## Research question

When GPU prices move unusually, is the change concentrated among a few hosts or spread across the market? Measure its magnitude, duration and host participation. A large rental workload is a possible explanation to investigate separately; the model does not assume an actor or cause.

The study prepares daily prices, establishes a historical baseline, then examines the magnitude, duration and seller participation behind unusual movements.

Pearl mining is a possible contributor to rental demand during the rise. The
study establishes broad repricing within this sample; it does not estimate
Pearl's share of the increase. The [Pearl notes](pearl_notes.md) separate the
rented-GPU evidence, network history and later protocol changes.

## Two figures

1. **Magnitude, duration and breadth:** the matched-model price index against a historical baseline, percentage departures, host repricing and daily matching coverage.
2. **Lower, median and upper price changes:** each configuration's price relative to its own April median, with lower/upper baselines and a coverage strip. These are repricing percentiles, not cheap/premium service tiers. The median's pre-May series is flat, so it is shown without a fitted residual band.

Both figures retain all 179 daily observations. Genuine price movements remain in the index.

## Historical coverage

Of 804 qualifying machines, 112 appear in every calendar month; the longest record contains 176 of 179 daily prices. The report retains its daily matching and April-reference rules. The exploratory history-length filters are not part of the main analysis; the [machine histories](outputs/daily/robustness/machine_histories.csv) and [rule comparison](outputs/daily/robustness/history_rule_summary.csv) remain available as research records. The expanded coverage report is preserved in `../archive/2026-09-24-history-coverage-detail/rtx3090/`.

## Findings

On May 9 the median price relative is unchanged from April, the upper change is approximately +20%, and 9 of 59 eligible hosts quote more than 10% above their April references. By May 30 the lower, median and upper changes are +72.1%, +171.8% and +544.5%, with 39 of 40 eligible hosts above +10%. That later distribution contains 68 of the April cohort's 308 machines. The host comparison covers 40 of 59 listed hosts that day. These checkpoints have changing membership, not continuous observation of a balanced panel.

The main index peaks at 240.1 on May 30, rebased to April 30 = 100. Its positive baseline departure runs May 14–June 13, confirmed May 16. May 29's +48.4% daily link uses 29 machines and fails coverage when two daily quotes are required. Equal-host and direct-reference alternatives peak at different levels; the precise increase depends on the estimator and sample.

The new diagnostic evaluates every consecutive calendar-day transition, with all 106 post-April comparisons passing the primary coverage gates. On May 30 the full distribution's median relative falls from 329.0 to 271.8, while the matched comparison rises from 329.0 to 369.0 (26 configurations, 19 hosts). Every full-host omission retains a positive matched median movement on that date. Requiring two daily quotes retains 103 of 106 comparisons; May 28–30 fail coverage, so the May 30 example remains dependent on the primary quote rule. Listing turnover can change the direction of the apparent median movement.

The lag-plus-weekend regression is not adopted. Over May–August its RMS log error is slightly lower than persistence for the lower component (5.35 versus 5.51, multiplied by 100), but worse for the upper component (15.21 versus 10.75). The existing slow EWMA is retained as a reference for sustained departures, not as a superior next-day forecast. The median lacks training variation for either the regression or the residual-band calibration.

## Measurement and modeling

- **Price index:** chained Jevons index of daily median posted quotes, matching recorded machine configuration across adjacent calendar days. Require 20 machines and 10 hosts per link; invalid links break the chain. Source units remain USD/hour because GPU quantity is unavailable.
- **Historical baseline:** robust EWMA on the log index. March sets the residual-update cap, April selects the half-life and historical residual limits. Score before updating. Three consecutive same-side exceedances define an episode; parameters stay fixed from May onward.
- **Host participation:** one vote per eligible host, based on the median log price relative of its April-reference configurations. Above/below thresholds are +10% and −10%. The eligible denominator changes daily.
- **Cohort:** configurations listed on at least five April days. Membership and own-price references are fixed before May. No future-survival condition, no carried-forward prices. Daily components require 20 machines and 10 hosts.
- **Daily distribution checks:** compute each percentile on both full daily samples and on their common configurations. Gate both populations. Report differences in percentage points, without chaining those differences into an index or giving them causal interpretations. Repeat under 1/2/3/6 daily quotes and omit each whole host. P90 is an explicit additional sensitivity to P95.
- **Forecast comparison:** persistence, EWMA and a three-parameter regression for the mean of each daily log component (intercept, prior day, weekend). Fit through April 30; score later days before updates using squared log error. Missing calendar days remain missing. This is aggregate forecasting, not machine-level conditional quantile regression.
- **Rental inference:** retained in supporting exports under the six-hour disappearance assumption. These are not verified bookings. Search truncation changes sharply between April and May; the counts do not identify comparable rental demand.

The collector returns at most 64 listings with unknown ranking. Matching and fixed eligibility do not recover unseen prices or make the sample representative of the entire marketplace. Host omission ranges are sensitivity checks, not confidence intervals. The historical period already informed the study's design; chronological replay is not untouched validation and false-alarm rates are unestablished.

## Reproduce

```sh
../marconi100/.venv/bin/python -m unittest test_indices test_daily_baseline test_market_checks test_rentals test_price_components test_component_diagnostics test_repricing test_history_coverage
../marconi100/.venv/bin/python run_price_model.py
```

The full suite (`python -m unittest discover -p 'test_*.py'`) has 55 tests, including checks for daily matching, coverage failures, entry effects, calendar gaps, forecast chronology, distinct-day counting and selection before May. Raw Parquet inputs remain in `../vast-market/data/`; hashes are checked on every execution. The Python source generates the executed Jupyter notebook and its HTML preview. `charts.py` uses Matplotlib for the full notebook diagnostics and two simpler article figures: the index against its baseline, and seller participation at 10% and 100% thresholds. Explanatory text stays outside the plotting area.

Run `python export_article.py` after the notebook to export desktop and mobile figures, the daily series, calculation details and `story-data.js` to `outputs/publication/`. The article uses D3 for three interactive chapters: the reference period, the full price history and seller participation. D3 reads the exported calculations; it does not refit the model. The published article lives in the AdamSioud website repository under `exemplars/gpu-prices/`.

The new computation module is [repricing.py](repricing.py). It builds on `indices.py`, `daily_baseline.py`, `price_components.py` and the existing diagnostic modules. No additional dependency is required.

## Data and reviews

Main exports: [price index](outputs/daily/daily_baseline.csv), [components](outputs/daily/price_components.csv), [host breadth](outputs/daily/host_breadth.csv), [checkpoints](outputs/daily/repricing_checkpoints.csv), [source/model audit](outputs/daily/summary.json).

New exports: [every daily transition](outputs/daily/robustness/daily_repricing_transitions.csv), [host sensitivity](outputs/daily/robustness/daily_transition_host_sensitivity.csv), [individual omission runs](outputs/daily/robustness/daily_transition_host_paths.csv), [quote-count sensitivity](outputs/daily/robustness/daily_transition_quote_sensitivity.csv), [forecast replay](outputs/daily/robustness/component_forecast_replay.csv), [scores by month](outputs/daily/robustness/component_forecast_scores.csv), [coefficients and unavailable fits](outputs/daily/robustness/component_forecast_parameters.csv).

Internal methodological reviews remain local because they discuss private
reference materials. Earlier reviews assessed versions before the repricing
extension. This extension has been locally tested, not independently reviewed.

The preceding report and notebook are preserved in `../archive/2026-09-24-before-repricing-study/rtx3090/`. Older exports and the earlier `rtx3090_market.html` study remain available; they do not define the current report.
