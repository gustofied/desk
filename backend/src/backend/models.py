from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Public contract returned by the health endpoint."""

    status: Literal["ok"] = "ok"
