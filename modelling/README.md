# Modelling

The two published studies are [GPU rental prices](https://www.adamsioud.com/exemplars/gpu-prices/)
and [energy monitoring in buildings](https://www.adamsioud.com/exemplars/building-energy/).
Their notebooks, calculation code and reproduction instructions live here.

- `rtx3090/`: the active notebook, calculation code, figures and article reference.
- `building-energy/`: the anonymised energy study, using simulated readings.
- `vast-market/data/`: shared, pinned Hugging Face source data; gitignored.
- `archive/`: previous RTX/Pearl notebooks and research. The broader seven-figure
  report is preserved in `2026-09-24-before-two-charts/`.
- `marconi100/`: earlier telemetry work and the existing local Python environment.
- `../references/`: earlier research material, local and gitignored.

The price notebook contains two daily figures covering February–August 2026:
the price index against a historical baseline, and the distribution of price
increases relative to April. Seller participation and sample coverage accompany
the prices. Earlier availability and rental-inference work remains as supporting
research; it does not define the current article.

[Pearl research notes](rtx3090/pearl_notes.md) record the evidence for mining as a
possible contributor to rental demand and the limits of that explanation.

`modelling/` is for research: exploring data, testing methods and producing
notebooks and figures. `../backend/` is the application service: its FastAPI API
and command-line entry points are in place, but ingestion, analytics and pipeline
modules are still placeholders. The price study is not connected to that API.
When a calculation is ready for Desk, its reusable implementation can move into
the backend while the notebook remains here to explain and evaluate it.

Use `modelling/` for all research paths.

## Files kept in Git

Research code, executed notebooks, notes and source manifests belong in Git.
Previous versions in `archive/`, generated HTML reports, figures, result tables,
logs and Python caches stay available locally but are ignored. Raw downloads and
private references also remain local, along with internal reviews that discuss
those references. Each study's README explains how to rebuild its outputs.
