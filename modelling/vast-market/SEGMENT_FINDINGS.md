# GPU market segments: executed findings

## What the segment comparison shows

The strongest distinction is **verification status**. Per 100 eligible visible observations, verified offers have 5.24 six-hour absence candidates, versus 0.90 for unverified offers. Within price bands, verified offers also have higher rates, including under the stricter requirement of three consecutive sightings before departure.

Under that stricter rule, **verified $0.10–$0.15/hour offers** have the highest rate among the displayed price-by-verification cells: **1.98 candidates per 100 eligible observations**, versus **0.28** for unverified offers at the same price. This is a descriptive visibility result, not a rental probability or causal verification effect.

The pooled price-only ranking is less robust: $0.15–$0.20/hour leads for the basic six-hour rule, while ≥$0.30/hour leads after requiring three prior consecutive appearances. Segment mix changes the answer.

**We cannot identify which segment was actually rented.** 88.1% of scans hit the listing cap; 47.4% of clean observed returns occur within roughly 30 minutes; 35.7% of machines visible in consecutive clean scans switch ask ID. These observations make both listing selection and offer identity important. A different ask ID may represent a different offer/configuration on the same machine, not necessarily a completed rental.


## What was built

Nine figures cover price distributions, scan caps, segment exit rates, geography, monthly changes, absence-duration sensitivity, host concentration, machine visibility, price-by-verification heatmaps and individual return examples. The notebook includes all code and detailed denominators. The downloadable CSVs retain the aggregate data underlying the charts.

## Main denominator

A rate of 1.98 means 1.98 observed six-hour absence starts per 100 qualifying visible machine-scan observations. It is not the proportion of GPUs rented, the fraction of time occupied, or an executed transaction count. A machine may contribute many observations and multiple departures. Repeated observations are dependent.

## Additional results

- 1,624,024 observations, 1,662 machines and 614 hosts.
- 25,941 clean adjacent scan pairs; failed attempts, unknown metadata and long gaps are excluded.
- 614,464 observed exits; 611,549 have a return within a clean observation block.
- 65.7% of those returns use the same ask ID.
- 42,884 six-hour absence candidates; 3,590 returned 6–72-hour gaps follow at least three consecutive sightings.
- The five largest hosts account for 21.0% of eligible exposure and 15.0% of exits. Removing them does not eliminate the basic mid-price turnover pattern, but other confounding remains.
- The US has the highest six-hour absence rate among the eight individually displayed countries (3.03%); the pooled Other category is higher. This is not a ranking of countries by rental demand.
- Every ask ID maps to a single machine and host. However, 88 machines have more than one country label and 690 have both verification states across the capture. Segment membership is time-varying.

## Interpretation for the article

A single visible price distribution mixes multiple classes of offers with different persistence. Qualification criteria and listing selection can change both the apparent price and turnover signal. The empirical story is about **which offers remain visible and how the mix changes**, with actual rental demand still unobserved. The next useful data acquisition is uncapped inventory plus explicit rented-state or lease/transaction records, with the same qualifying attributes retained.

Source: Marc Lammers, [Vast.ai RTX 3090 Spot Market dataset](https://huggingface.co/datasets/MarcusLammers/vast-rtx3090-market-6mo), CC BY 4.0. See README for reproduction and observation definitions.
