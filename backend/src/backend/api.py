from fastapi import APIRouter

from .models import HealthResponse

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health() -> HealthResponse:
    return HealthResponse()
