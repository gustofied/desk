# Vast RTX 3090 market visibility

Listing turnover and price differences across RTX 3090 market segments.

[Notebook](market_segments.ipynb) · [Segment findings](SEGMENT_FINDINGS.md) · [Listing turnover](FINDINGS.md) · [Source](segment_study.py)

## Run

Run from this folder with Python 3.12:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python download_data.py
.venv/bin/python run_segments.py
```

Edit `segment_study.py`; the runner builds and executes the notebook, exports an HTML report and writes figures and tables to `segments/`.

Downloads use the revision in `source-manifest.json`. `input_hashes.json` identifies the analysed files.

## Definitions

A clean pair requires successful scans, unchanged logger version, 5–15-minute spacing and no failed attempt between them. A machine seen before but absent next is an observed exit. A prolonged-absence candidate additionally requires continued clean scanning through the chosen horizon and no observed return within it. Exposure-normalized rates count events per 100 eligible machine-scan observations; they are not occupied-GPU shares, rental probabilities, transactions or time-weighted utilization.

Returning gaps are last sighting to first return and are interval-censored by scan cadence. Gaps crossing collection breaks and machines never observed returning are separated. The stricter sensitivity check requires at least three consecutive sightings before departure. Price bands use listed USD/hour, not normalized per-GPU charges. Country and verification segments use contemporaneous attributes.

## Source and limitations

Marc Lammers, [Vast.ai RTX 3090 Spot Market dataset](https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo), CC BY 4.0. See `dataset-card.md` and `source-manifest.json`.

Actual rental events are unobserved. Query ordering is undocumented and 88% of scans hit the 64-offer cap. Even prolonged absence followed by relisting does not prove a rental. The analysis is descriptive; price, host, country and verification are confounded, and repeated observations are dependent.
