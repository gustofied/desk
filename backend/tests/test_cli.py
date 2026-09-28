from typer.testing import CliRunner

from backend.cli import app

runner = CliRunner()


def test_help() -> None:
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0
    assert "serve" in result.output
    assert "ping" in result.output
