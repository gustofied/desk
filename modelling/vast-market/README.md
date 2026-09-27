# Vast RTX 3090 market visibility

- `market_report.html`: compact graph report with the main interpretation.
- `market_segments.html`: readable executed segmentation notebook, charts and tables.
- `market_segments.ipynb`: executed Jupyter notebook.
- `SEGMENT_FINDINGS.md`: interpretation and main quantitative results.
- `FINDINGS.md`: earlier price-composition example linked to The Compute Bazaar article.
- `segment_study.py`: editable percent-format notebook source.
- `segments/`: nine figures and aggregate CSV/JSON results.

## Run

The existing shared analysis environment is `../marconi100/.venv/bin/python`. Alternatively create a Python 3.12 environment and install `requirements.lock.txt`.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python download_data.py
.venv/bin/python run_segments.py
```

Run from this folder. The runner executes all notebook cells and exports a self-contained HTML copy. Its kernel needs local socket access. Edit `segment_study.py` rather than the generated notebook to preserve changes on regeneration. In a notebook editor, select the analysis environment's Python interpreter.

Downloads use the revision recorded in `source-manifest.json`. The original first inspection downloaded `main`; `input_hashes.json` identifies the exact local inputs used here. Raw input data, detailed event data, environments and caches are gitignored.

## Definitions

A clean pair requires successful scans, unchanged logger version, 5–15-minute spacing and no failed attempt between them. A machine seen before but absent next is an observed exit. A prolonged-absence candidate additionally requires continued clean scanning through the chosen horizon and no observed return within it. Exposure-normalized rates count events per 100 eligible machine-scan observations; they are not occupied-GPU shares, rental probabilities, transactions or time-weighted utilization.

Returning gaps are last sighting to first return and are interval-censored by scan cadence. Gaps crossing collection breaks and machines never observed returning are separated. The stricter sensitivity check requires at least three consecutive sightings before departure. Price bands use listed USD/hour, not normalized per-GPU charges. Country and verification segments use contemporaneous attributes.

## Source and limitations

Marc Lammers, [Vast.ai RTX 3090 Spot Market dataset](https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo), CC BY 4.0. See `dataset-card.md` and `source-manifest.json`.

Actual rental events are unobserved. Query ordering is undocumented and 88% of scans hit the 64-offer cap. Even prolonged absence followed by relisting does not prove a rental. The analysis is descriptive; price, host, country and verification are confounded, and repeated observations are dependent.
