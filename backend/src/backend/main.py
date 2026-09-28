import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api import router
from .config import settings
from .logging_config import setup_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    logger.info("API started")
    yield
    logger.info("API stopped")


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(router)
app.frontend("/", directory=settings.frontend_dir)
