# Marconi100: thermal behavior study

[Notebook](marconi100_analysis.ipynb) · [Findings](FINDINGS.md) · [Source](study.py)

The study audits two small rack archives and analyzes eight available nodes selected evenly by ID among nodes with enough pre-test coverage, using January 2021–September 2022 sensor data. It compares an additive spline thermal model, PCA and a small autoencoder; inspects sustained episodes, shared changes and retrospective segmentation; and reports data coverage and chronological holdout performance.

## Reproduce

Use Python 3.12 and an isolated environment:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python download_data.py
.venv/bin/python run_notebook.py
```

Run from this directory. The downloader fetches racks 0 and 5 (about 567 MB), verifies publisher checksums and extracts the Parquet files. The runner produces results, figures and an HTML report. Use `.venv/bin/python` as the notebook kernel.

Edit `study.py`; `run_notebook.py` rebuilds and executes the notebook from it.

## Provenance and limits

- Borghesi et al., [M100 ExaData, Scientific Data (2023)](https://www.nature.com/articles/s41597-023-02174-3).
- [15-minute aggregated IPMI data with Nagios states](https://doi.org/10.5281/zenodo.7541722), CC BY 4.0. The original record manifest is `source-manifest.json`.
- [Publisher documentation](https://gitlab.com/ecs-lab/exadata/-/tree/main/documentation), with local copies of IPMI, Nagios and rack metadata in `documentation/`.
- Archives are convenience-selected by size. Some nominal rack node IDs have no file. Modeling selects four evenly spaced **available** IDs per rack, after requiring >1,000 complete state-0 training rows and >500 calibration rows, without optimizing for anomaly results.
- No direct workload/utilization data is in this aggregate. The study addresses thermal behavior conditional on power, not energy efficiency per completed job.
- Nagios states are heterogeneous operational labels, not complete thermal-fault ground truth. No causal claim, savings claim, or validated failure-prediction claim is made.
