from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_frontend() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "Backdesk" in response.text
