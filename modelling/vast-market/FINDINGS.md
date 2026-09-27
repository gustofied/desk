# The visible market can move without continuing offers repricing

Initial empirical inspection, 23 September 2026. This follows the availability and benchmark argument in Adam Sioud's [The Compute Bazaar](https://www.adamsioud.com/exemplars/compute/feeling_the_compute.html#financialization), especially its distinction between disappearing cheap offers and actual seller repricing.

## What was checked

Downloaded and read the actual offer panel and scan metadata from [Marc Lammers' Vast.ai RTX 3090 dataset](https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo), CC BY 4.0. Repository revision at inspection: `8bc8ca0d55eebdcca86b92aae71abe2510dae0f1`. Download URLs used `main`; the revision records the inspected manifest, rather than claiming a cryptographic pin on the downloaded files.

The panel contains 1,624,024 rows, 26,066 observed scans and 1,662 machines. No duplicate ask IDs or machine IDs occur within a scan. There are 118 observed scans without corresponding metadata. The metadata contains 25,948 successful and seven failed attempts. Scans never exceed 64 rows; 88.08% contain exactly 64.

The independently recomputed observation-weighted monthly medians are $0.1356/hour in April and $0.1744/hour in May: +28.61%. These are listed offer prices, not verified executed rental prices or normalized per-GPU prices. The published fields omit GPU quantity, limiting product comparability.

## A concrete example for the story

At **2026-05-25 10:26:32 UTC**, versus the successful scan 600 seconds earlier:

| Measure | Before | After |
|---|---:|---:|
| Visible offers | 63 | 59 |
| Median listed offer price | $0.2022/hour | $0.2422/hour |
| Offers present in both | 32 | 32 |
| Median price of those 32 continuing offers | $0.25095/hour | $0.25095/hour |

**The visible median rose 19.78%, while none of the 32 continuing offers changed its listed price.** There were 31 departures and 27 arrivals in the observed set. This illustrates composition changing an index without observed repricing among continuing offers. It does not establish why those offers entered or left, nor what happened to their prices outside the observed sample.

Six continuing offers changed at least one recorded specification field (including disk space); they are not guaranteed unchanged contracts. The price identity still holds. No rental or scarcity inference is made.

This example was selected retrospectively: among adjacent successful scans 5–15 minutes apart with unchanged logger version and at least 32 common asks, find median increases of at least 15% with no continuing-ask repricing, then select the largest. Two pairs meet that rule among 1,735 eligible pairs. It illustrates a mechanism, not its overall prevalence.

![Visible composition example](results/composition_example.png)

## The strongest next statistical question

**When is a move in the visible market unusual after accounting for ordinary listing turnover and changes in the mix of offers?**

Track three distinct objects:

1. Changes in quotes for the same observed offers, then stable machine/configuration cohorts where possible.
2. The mix of machines, hosts, locations and attributes in each scan.
3. Visibility spells, returns and the count/share of qualifying observed offers under a price ceiling.

The median of shared offers supplies an exact descriptive decomposition:

`change in overall median = change in shared-offer median + composition remainder`.

This is a reference-dependent accounting identity, not a causal attribution. Shared offers are selected survivors and may not represent the market.

Across 25,942 consecutive successful pairs 5–15 minutes apart, median overlap is just 25 asks (10th–90th percentiles: 19–30). That large turnover, together with the cap and undocumented ordering, makes collector selection an essential part of the analysis. The current records do not justify inferring rentals from absence, or treating observed-offer counts as total available GPU capacity.

A useful first model would establish conditional baselines for observed turnover and offer mix, then segment persistent departures. Only after examining collection behavior should we test whether observed availability changes precede repricing. A VAE would not resolve the missing observation mechanism.

## Reproduce

Run `../marconi100/.venv/bin/python inspect_market.py` from this folder (or use a Python environment with pandas, pyarrow, numpy and matplotlib). Input Parquet files are local and gitignored. The script writes CSV/JSON diagnostics and a figure into `results/`. No website or Desk UI changes have been made.
