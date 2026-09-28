# Marconi100: power and temperature

[Notebook](marconi100_analysis.ipynb) · [Reproduce](README.md#reproduce)

## Data

Audited **2,171,312 source rows across 27 available nodes** in two checksum-verified rack archives. Modeled eight eligible nodes: [2, 9, 14, 19, 103, 109, 112, 118]. The analysis covers January 2021–September 2022, with Jan–Aug 2021 training, Sep–Dec 2021 calibration, and 2022 testing. Data preparation uses an explicit 15-minute UTC grid without filling gaps. Modeling coverage varies by node; details are in `results/thermal_fit.csv`.

## What worked

| Conditional temperature estimator | Mean of per-node test MAE |
|---|---:|
| Inlet temperature + training median thermal lift | 3.266 °C |
| Linear regression on power, inlet and lagged inputs | 0.559 °C |
| Additive spline regression on the same inputs | 0.597 °C |

Conditioning on measured power explains much of the temperature variation, especially in the higher-power rack-5 sample. Linear regression slightly outperforms the more flexible spline on the macro-average, so complexity is not yet justified. These are contemporaneous conditional estimates, not forecasts.

## The most informative episode

The spline flags node 9 on **10 September 2022 01:30 UTC–12 September 2022 09:30 UTC** for 56 hours, with an average **+3.44 °C** residual. Other sampled nodes in the rack do not show the same residual pattern. Its monitoring state remains 0.

However, approximately **99.1%** of episode CPU-power values are below the training 1st percentile. Removing CPU power reduces the mean residual to **+0.86 °C**. The raw GPU temperature is around the mid-30s °C, not an obvious overheating episode. This is evidence of a changed operating relationship and model sensitivity, not a confirmed physical fault. The ablation is post-hoc and cannot validate a replacement model on its own.

The fixed spline threshold generates **86** positive-residual episodes lasting at least an hour. Those are investigation candidates; the strongest demonstrates why a flag count is not a fault count.

## What did not work

All tested scores show poor agreement with the broad Nagios states. Macro ROC-AUC: thermal spline **0.441**, PCA **0.379**, autoencoder **0.419**. These labels mix operational conditions and are not thermal-fault truth. Unknown/missing labels are excluded from scoring, and metrics use identical complete rows across models.

The small autoencoder still reaches its 300-epoch cap with a convergence warning; it is a preliminary baseline. No VAE was trained, and no optimized neural-model comparison is claimed.

## Interpretation

The results identify changes in power–temperature relationships that warrant investigation. Per-GPU comparisons and neighbouring-node measurements could help explain them. This sample does not establish a reliable fault detector or quantify energy savings.

Further work needs utilization and job measurements, detailed monitoring labels and a larger rack sample.

Source: Borghesi et al., [M100 ExaData](https://www.nature.com/articles/s41597-023-02174-3); [aggregated dataset](https://doi.org/10.5281/zenodo.7541722), CC BY 4.0.
