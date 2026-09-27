# Marconi100: thermal behavior study

Open `marconi100_analysis.ipynb` for the executed Jupyter notebook, or `marconi100_analysis.html` for a standalone rendered copy. `FINDINGS.md` contains the interpretation of the actual run.

The study audits two small rack archives and analyzes eight available nodes selected evenly by ID among nodes with enough pre-test coverage, using January 2021–September 2022 sensor data. It compares an additive spline thermal model, PCA and a small autoencoder; inspects sustained episodes, shared changes and retrospective segmentation; and reports data coverage and chronological holdout performance.

## Reproduce

Use Python 3.12 and an isolated environment:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python download_data.py
.venv/bin/python run_notebook.py
```

Run from this directory. The downloader fetches racks 0 and 5 (about 567 MB combined), verifies publisher MD5 checksums, and extracts regular Parquet members. The notebook creates results, images and an HTML export. Internet is only required for setup/download. The Jupyter kernel needs local socket access. `run_notebook.py` creates its own local kernel specification, so it does not alter your global Jupyter installation. In an editor, select `.venv/bin/python` as the notebook kernel.

`study.py` is the editable percent-format source; `run_notebook.py` rebuilds the notebook from it. Edit the source if you want changes to survive regeneration. Source metadata, code and the executed notebook are kept in Git. Data, environments, Jupyter caches, generated HTML and result files remain local and are gitignored.

## Provenance and limits

- Borghesi et al., [M100 ExaData, Scientific Data (2023)](https://www.nature.com/articles/s41597-023-02174-3).
- [15-minute aggregated IPMI data with Nagios states](https://doi.org/10.5281/zenodo.7541722), CC BY 4.0. The original record manifest is `source-manifest.json`.
- [Publisher documentation](https://gitlab.com/ecs-lab/exadata/-/tree/main/documentation), with local copies of IPMI, Nagios and rack metadata in `documentation/`.
- Archives are convenience-selected by size. Some nominal rack node IDs have no file. Modeling selects four evenly spaced **available** IDs per rack, after requiring >1,000 complete state-0 training rows and >500 calibration rows, without optimizing for anomaly results.
- No direct workload/utilization data is in this aggregate. The study addresses thermal behavior conditional on power, not energy efficiency per completed job.
- Nagios states are heterogeneous operational labels, not complete thermal-fault ground truth. No causal claim, savings claim, or validated failure-prediction claim is made.
