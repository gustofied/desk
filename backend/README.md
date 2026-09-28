# Desk backend

The initial backend skeleton for [Desk](../README.md), with FastAPI and Typer
entry points for the analytics pipeline.

## Run

Requires Python 3.13 and `uv`. Run these commands from `backend/`. FastAPI serves
the self-contained demo frontend from `frontend/`.

```bash
uv sync --locked
uv run backend serve
```

- Frontend: <http://127.0.0.1:8000/>
- Health: <http://127.0.0.1:8000/api/health>
- API docs: <http://127.0.0.1:8000/docs>

## Check

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

## Demo

```bash
./scripts/demo.sh
```

The current demo verifies the environment, tests, API and frontend. Ingestion,
analytics and pipeline modules are still placeholders. The RTX 3090 study runs
separately in [the modelling folder](../modelling/rtx3090/).

## Flow

The planned flow is:

```text
Research → reusable calculation → backend pipeline → API → Desk view
```

The pipeline would read and validate source data, run the calculation and save a
dated result. The API would expose that result to the frontend. The notebooks stay
in [the research folder](../modelling/)
to explain and evaluate the methods.
