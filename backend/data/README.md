# Data

- `bronze/` contains source data exactly as supplied.
- `silver/` contains canonical, validated records when materialized.
- `gold/` contains derived analytical outputs when materialized.

Bronze inputs are never modified. Silver and Gold must be reproducible from
Bronze. Stages may remain in memory when materializing them provides no value.
