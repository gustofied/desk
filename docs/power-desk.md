# Power desk

Three starter views, using generated data. No exchange connection or credentials are required.

| View | Benchmark | Purpose |
| --- | --- | --- |
| PJM Dominion | Dominion Zone (DOM), not Dominion Hub | Northern Virginia power exposure |
| ERCOT North | North Load Zone (LZ_NORTH), not North Hub | North Texas power exposure |
| GPU energy | H100 energy component using PJM Dominion by default | Put wholesale power in GPU-hour terms |

PJM West (Western Hub) remains available. These are regional benchmarks, not a data center's nodal settlement or delivered electricity tariff. RT is solid; DA is dashed; Spread is RT minus DA. All timestamps are UTC. Regional profiles use their local IANA timezone, including DST.

## Energy estimate

`USD/GPU-hour = USD/MWh × node kW × PUE ÷ GPUs per node ÷ 1,000`

The fixed example uses an eight-GPU DGX H100 system at its **10.2 kW maximum system power**, with **PUE 1.2 assumed**, not measured. The multiplier is 0.00153; $50/MWh therefore corresponds to $0.0765/GPU-hour. RT and DA use the same assumptions. Negative wholesale prices remain negative in this arithmetic, without implying that a particular operator would receive that credit.

This is the electricity component only. It is not a GPU rental price, profit margin, delivered bill, measured consumption, or promise of available capacity. Demand/network charges, taxes, hedges, PPAs, utilization and site-specific costs are not included. CLI download contains the underlying $/MWh observations; the SQL view shows the energy conversion.

## Data and refresh

`node scripts/generate-power-basis.mjs` creates reproducible hourly examples covering a year through 29 August 2026. `npm run build:data` produces the browser payload and JSON export. These are fixed demo histories—not live prices or notifications. The original West observations over its previous 90-day window are preserved.

Ranges: 1D, 7D, 90D and 1Y. Existing `all` links remain valid. The Power collection is introduced through a versioned migration, preserving existing views and user deletions. Views use the normal save, pin and shared-desk paths.

## Research behind the selection

- [EIA: Dominion load growth](https://www.eia.gov/todayinenergy/detail.php?id=67664) informed the Northern Virginia choice.
- [EIA: PJM and ERCOT electricity demand](https://www.eia.gov/todayinenergy/detail.php?id=67344) informed the two-region comparison.
- [NVIDIA DGX H100 specifications](https://docs.nvidia.com/dgx/dgxh100-user-guide/introduction-to-dgxh100.html) supplies the hardware maximum; PUE remains an explicit assumption.

Before replacing examples with a public feed, review [PJM's API terms](https://www.pjm.com/-/media/DotCom/etools/data-miner-2/data-miner-2-api-guide.ashx?la=en), [ERCOT's terms](https://www.ercot.com/help/terms), and [ERCOT API limits](https://developer.ercot.com/applications/pubapi/known-limits/). No data-provider access or redistribution rights are implied by this demo.
