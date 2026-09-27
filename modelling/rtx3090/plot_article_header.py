"""Draw the article header from the existing daily price-model results."""
from pathlib import Path
import argparse
import os

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".cache" / "matplotlib"))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import pandas as pd

PAPER = "#fdfcfa"
INK = "#484a48"
GRAY = "#959792"
RED = "#b17b78"


def listing_changes(quotes, dates):
    """Daily price-change ranges, pairing each configuration on adjacent days."""
    prices = quotes.pivot(index="day", columns="configuration", values="price")
    prices = prices.reindex(dates)
    changes = 100 * (prices / prices.shift(1) - 1)
    return pd.DataFrame({
        "low": changes.min(axis=1),
        "high": changes.max(axis=1),
        "q10": changes.quantile(.10, axis=1),
        "q90": changes.quantile(.90, axis=1),
    })


def draw_header(data, episodes, changes, output, compact=False, preview=False):
    """A dense daily price-change trace above the index's baseline departure."""
    width, height = (800, 420) if preview else ((450, 140) if compact else (900, 180))
    fig = plt.figure(figsize=(width / 100, height / 100), dpi=100, facecolor=PAPER)
    price_box = [0, .40, 1, .55] if preview else [.004, .48, .992, .50]
    departure_box = [0, 0, 1, .38] if preview else [.004, .10, .992, .31]
    price = fig.add_axes(price_box, facecolor=PAPER)
    departure = fig.add_axes(departure_box, facecolor=PAPER, sharex=price)
    x = data.index
    main = episodes.loc[episodes.direction.eq("Above")].sort_values("peak_deviation_pct").iloc[-1]
    active = (x >= main.start) & (x <= main.end)
    for ax in (price, departure):
        ax.set_axis_off()
        ax.set_xlim(x.min(), x.max())

    # Symmetric log scaling keeps both quiet days and the largest individual
    # repricings visible. Every stem is a real daily range; no synthetic noise.
    extent = max(changes.low.abs().max(), changes.high.abs().max()) * 1.08
    price.set_yscale("symlog", linthresh=2)
    price.set_ylim(-extent, extent)
    price.axvspan(main.start, main.end, facecolor=RED, alpha=.22, linewidth=0)
    price.vlines(x, changes.low, changes.high, color=INK,
                 linewidth=.72 if compact else 1.05, alpha=.88)
    price.vlines(x, changes.q10, changes.q90, color=INK,
                 linewidth=1.15 if compact else 1.8)
    price.axhline(0, color=INK, linewidth=.55, alpha=.65)
    for boundary in (main.start, main.end):
        price.axvline(boundary, color=INK, linewidth=1.1)

    # The sharing composition deliberately crops the lower tail at the frame.
    # The article figures retain their full scales and reference lines.
    floor = -.75 if preview else 0
    departure.set_ylim((floor, 135) if preview else (-9, 140))
    departure.fill_between(x, floor, data.deviation_pct, color=GRAY, alpha=.65, linewidth=0)
    departure.fill_between(x, floor, data.deviation_pct, where=active,
                           interpolate=True, color=RED, alpha=.54, linewidth=0)
    departure.plot(x, data.deviation_pct, color=INK, linewidth=1.7 if preview else 1.25)
    departure.plot(x, np.where(active, data.deviation_pct, np.nan), color=RED,
                   linewidth=1.9 if preview else 1.4)
    if not preview:
        departure.axhline(0, color=INK, linewidth=.7)

    # Keep dates on the article banner; the sharing artwork is edge to edge.
    if not preview:
        for date in pd.date_range(x.min().normalize(), x.max(), freq="MS"):
            departure.plot([date, date], [0, -.08], color=INK, linewidth=.7,
                           transform=departure.get_xaxis_transform(), clip_on=False)
            departure.text(mdates.date2num(date), -.17, date.strftime("%b").upper(),
                           transform=departure.get_xaxis_transform(), ha="center", va="top",
                           fontsize=5.5 if compact else 6.5,
                           color=INK, fontfamily="DejaVu Serif")

    name = "price-share-preview" if preview else ("price-header-mobile" if compact else "price-header")
    description = (
        "Daily RTX 3090 listing price changes above: thin stems show each day's "
        "minimum to maximum, thicker stems the 10th to 90th percentiles, on a "
        "symmetric log scale. Only configurations listed on adjacent days are paired. "
        "Below: the daily price index's percentage departure from its baseline. "
        "February 17 to August 14, 2026. The shaded window marks May 14 to June 13."
    )
    fig.savefig(output / f"{name}.svg", metadata={"Title": "Modelling GPU rental prices",
                "Description": description, "Date": None})
    fig.savefig(output / f"{name}.png", dpi=300, metadata={"Description": description})
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "outputs" / "publication")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    data = pd.read_csv(ROOT / "outputs" / "daily" / "daily_baseline.csv", index_col="day", parse_dates=["day"])
    episodes = pd.read_csv(ROOT / "outputs" / "daily" / "episodes.csv", parse_dates=["start", "end"])
    quotes = pd.read_csv(ROOT / "outputs" / "daily" / "daily_quotes.csv", parse_dates=["day"])
    changes = listing_changes(quotes, data.index)
    with plt.rc_context({"svg.hashsalt": "gpu-price-header", "path.simplify": False}):
        draw_header(data, episodes, changes, args.output)
        draw_header(data, episodes, changes, args.output, compact=True)
        draw_header(data, episodes, changes, args.output, preview=True)
    print(f"Rendered headers and sharing preview in {args.output}")
