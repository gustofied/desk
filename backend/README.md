# Desk backend

A Python backend skeleton for [Desk](../README.md), built with FastAPI and Typer.
API startup, a health endpoint, CLI commands, configuration and logging are in
place. Ingestion, analytics and pipeline modules are laid out; their processing
logic is still to be implemented. Research models run separately in
[modelling/](../modelling/).

## Run

Requires Python 3.13 and `uv`. Run from `backend/`:

```sh
uv sync --locked
uv run backend serve
```

- Demo frontend: <http://127.0.0.1:8000/>
- Health: <http://127.0.0.1:8000/api/health>
- API docs: <http://127.0.0.1:8000/docs>

## Check

```sh
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

`./scripts/demo.sh` runs the tests, starts the server and checks both the frontend
and health endpoint.

## Planned flow

Research → calculation → pipeline → API → Desk

Reusable calculations belong in the backend; notebooks explain and evaluate the
methods. The pipeline would validate inputs and save dated results for the API.
