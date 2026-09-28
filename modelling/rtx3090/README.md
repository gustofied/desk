# Modelling GPU rental prices

RTX 3090 rental quotes on Vast.ai, February–August 2026. The study asks whether
price increases are concentrated among a few sellers or shared across the sample.

[Article](https://www.adamsioud.com/exemplars/gpu-prices/) · [Notebook](price_model.ipynb) · [Source](price_model.py)

## Findings

The daily price index peaks at 240.1 on May 30, with April 30 set to 100. It stays
above its historical range from May 14 to June 13. At the peak, 39 of 40 eligible
sellers quote more than 10% above their April prices; 34 quote more than 100% above.

The increase is widespread within the sample. Its size depends on the method:
May 29's +48.4% daily change uses 29 machines and fails coverage when two daily
quotes are required. Equal-seller weighting and a direct April comparison give
different peak levels. [Pearl mining](pearl_notes.md) may have contributed to
demand, but these records do not establish its share of the increase.

## Method

- **Price index:** chained geometric mean of daily price ratios for configurations listed on consecutive days. Each daily link requires at least 20 machines and 10 sellers. Missing links break the chain.
- **Baseline:** exponential smoothing of the log index, with a cap on each update. March sets the cap; April sets the smoothing rate and reference range. Parameters stay fixed from May onward. Three consecutive departures on the same side define an episode.
- **Seller participation:** one vote per eligible seller, using the median log price change of its configurations against their April references.
- **Price distribution:** lower, median and upper changes for configurations listed on at least five April days. Prices are not carried forward when a configuration disappears.

The notebook examines sample coverage, listing turnover, alternative price
measures and the effect of removing individual sellers. It also compares simple
forecasts on later periods.

Searches return at most 64 listings, with unknown ordering. Matching tracks price
changes within those records; it does not recover unseen inventory. Quotes are in
USD/hour because GPU quantity is unavailable. Absences of at least six hours are
treated as inferred rentals, not verified bookings. The study is retrospective; the reference range has no
established false-alarm rate.

## Reproduce

Run from this folder with Python 3.12:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python ../vast-market/download_data.py
.venv/bin/python -m unittest discover -p 'test_*.py'
.venv/bin/python run_price_model.py
.venv/bin/python export_article.py
```

`price_model.py` generates the executed notebook and HTML report. Inputs are
checked against their recorded hashes. Tables are written to `outputs/daily/`;
article data and figures go to `outputs/publication/`. Matplotlib draws the
notebook figures; the article's D3 charts use the exported values.

[Source data](https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo):
Marc Lammers, CC BY 4.0. See also [index methodology](index_methodology_notes.md)
and [Pearl research](pearl_notes.md).
