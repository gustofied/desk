---
license: cc-by-4.0
pretty_name: Vast.ai RTX 3090 Spot Market, February-August 2026
language:
  - en
tags:
  - gpu
  - cloud-computing
  - market-data
  - time-series
  - pricing
  - vast-ai
size_categories:
  - 1M<n<10M
configs:
  - config_name: snapshots
    data_files: data/snapshots.parquet
    default: true
  - config_name: ask_lifecycle
    data_files: data/ask_lifecycle.parquet
  - config_name: snapshot_meta
    data_files: data/snapshot_meta.parquet
---

# Vast.ai RTX 3090 Spot Market, February-August 2026

Panel data from the [vast.ai](https://vast.ai) GPU rental marketplace, restricted to NVIDIA RTX 3090 offers. The public offer listing was polled every 10 minutes between 2026-02-13 and 2026-08-15. Each observation records price, hardware specifications, host reliability, and location. A derived lifecycle table gives the listing duration of every offer. Vast.ai does not publish historical listing data; this dataset was collected independently.

## Summary

| | |
|---|---|
| Observation period | 2026-02-13 to 2026-08-15 (UTC), uninterrupted |
| Scan interval | 600 seconds |
| Successful scans | 25,948 (99.97% success rate) |
| Observations (offer × scan) | 1,624,024 |
| Unique offers (asks) | 26,425 |
| Unique machines | 1,662 |
| Unique hosts | 614 |
| Countries | 66 |

Median listed price per month:

| Month (2026) | Median price ($/hr) | Median DLPerf per $ |
|---|---|---|
| Feb | 0.122 | 363 |
| Mar | 0.135 | 331 |
| Apr | 0.136 | 327 |
| May | 0.174 | 249 |
| Jun | 0.175 | 252 |
| Jul | 0.149 | 298 |
| Aug | 0.148 | 300 |

## Files

### `data/snapshots.parquet` (1,624,024 rows)

The raw panel: one row per visible offer per scan.

| Column | Type | Description |
|---|---|---|
| `snapshot_id` | string | UUID of the scan |
| `timestamp` | datetime (UTC) | Scan time |
| `snapshot_seq` | int | Monotonic scan sequence number |
| `scan_interval_sec` | int | Configured scan interval (600) |
| `ask_id` | int | Vast.ai offer ID |
| `machine_id` | int | Physical machine ID (stable across relistings) |
| `host_id` | int | Host (owner) ID |
| `price_usd_hour` | float | Listed price in USD per hour |
| `verified` | bool | Whether the machine is vast.ai-verified |
| `reliability` | float | Host reliability score reported by vast.ai (0 to 1) |
| `dlperf` | float | Vast.ai deep-learning performance score |
| `dlperf_per_dpth` | float | DLPerf per dollar-per-hour |
| `inet_up` / `inet_down` | float | Internet speed (Mbps) |
| `geo_country` | string | Country code |
| `geo_region` | string | Region within country |
| `cuda_max` | float | Max supported CUDA version |
| `gpu_ram` | float | GPU memory (MB) |
| `cpu_cores` | float | CPU cores allocated |
| `cpu_ram` | float | System RAM (MB) |
| `disk_space` | float | Disk space (GB) |
| `driver_version` | string | NVIDIA driver version |

### `data/ask_lifecycle.parquet` (26,425 rows)

Per-offer lifecycle: one row per unique offer, maintained incrementally by the logger.

| Column | Type | Description |
|---|---|---|
| `ask_id` | int | Offer ID |
| `first_seen` / `last_seen` | datetime (UTC) | First and most recent scan the offer appeared in |
| `survival_minutes` | int | Minutes between first and last sighting (listing duration) |
| `seen_count` | int | Number of scans the offer appeared in |
| `miss_streak` | int | Consecutive scans missed since last sighting |
| `min_price` / `max_price` / `last_price` | float | Price range over the offer's lifetime |
| `price_change_count` | int | Number of observed price changes |
| `is_active` | bool | Whether the offer was still listed at the end of the capture |
| `snapshot_seq` | int | Sequence number of the last scan it appeared in |
| `scan_interval_sec` | int | Scan interval (600) |

### `data/snapshot_meta.parquet` (25,955 rows)

One row per scan attempt: `status` (ok/error), `row_count`, `fetch_ms`, `http_status`, error details, and logger version. Useful for verifying data completeness.

## Methodology

A logger queried the public vast.ai offer listing every 600 seconds with a GPU filter of `RTX 3090`, appending every visible offer to the snapshot log. The lifecycle table was derived incrementally: an offer's `survival_minutes` is the time between its first and last appearance across scans.

## Known limitations

- Each scan returns at most ~64 offers (the query's result cap), so the dataset covers the visible top of the listing rather than the full RTX 3090 supply at every moment.
- Only offers matching the RTX 3090 filter were captured.
- An offer leaving the listing can mean it was rented or that it was delisted or went offline. The two cases can often be separated using `machine_id`: a machine that disappears and later relists was likely rented in between.
- `survival_minutes` measures how long an offer stayed listed, not machine uptime.
- Offers still active at the end of the capture (`is_active = true`) are right-censored.

## Usage

```python
import pandas as pd

snap = pd.read_parquet("data/snapshots.parquet")
life = pd.read_parquet("data/ask_lifecycle.parquet")

# Daily median price index
idx = snap.set_index("timestamp")["price_usd_hour"].resample("D").median()

# Host-level listing survival
hosts = life.merge(
    snap.drop_duplicates("ask_id")[["ask_id", "host_id"]], on="ask_id"
).groupby("host_id")["survival_minutes"].median()
```

Or with the `datasets` library:

```python
from datasets import load_dataset

ds = load_dataset("MarcusLammers/vast-rtx3090-market-6mo", "snapshots")
```

## Possible uses

- Spot-market price dynamics: how listing prices respond to supply changes over time.
- Survival analysis: predicting how long an offer stays listed. As a reference point, a baseline model using only host history reaches AUC 0.90 out-of-sample for 24-hour survival.
- Reconstructing rental demand from `machine_id` disappearance and relisting patterns.
- Studying the persistence of host behavior over multiple months.

## License and attribution

CC BY 4.0. Free to use, share, and adapt with attribution.

Collected and published by Marc Lammers ([augustus.cloud](https://www.augustus.cloud)). Please credit "Marc Lammers, Vast.ai RTX 3090 Spot Market dataset" when using this data.
