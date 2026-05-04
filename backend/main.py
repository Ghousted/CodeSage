import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import router

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

REQUIRED_ENV_VARS = ("PINECONE_API_KEY", "HUGGINGFACE_API_KEY")


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [v for v in REQUIRED_ENV_VARS if not os.environ.get(v)]
    if missing:
        logger.warning(
            "Missing required env vars: %s. Some endpoints will fail until they are set.",
            ", ".join(missing),
        )
    # Optionally pre-warm the embedding model so the first request isn't slow.
    if os.getenv("WARMUP_EMBEDDER", "1") == "1":
        try:
            from core.embedder import warmup
            warmup()
            logger.info("Embedding model pre-loaded.")
        except Exception as exc:
            logger.warning("Embedding model warmup failed: %s", exc)
    yield


app = FastAPI(
    title="CodeSage",
    description="AI-powered codebase analyzer with RAG",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow override via env (comma-separated). Defaults to local dev.
_allowed = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health():
    missing = [v for v in REQUIRED_ENV_VARS if not os.environ.get(v)]
    return {
        "status": "ok" if not missing else "degraded",
        "missing_env": missing,
    }


@app.exception_handler(RequestValidationError)
async def _validation_exc(_: Request, exc: RequestValidationError):
    # Return user-friendly validation errors instead of FastAPI's verbose default
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()[0]["msg"] if exc.errors() else "Validation error"},
    )


@app.exception_handler(Exception)
async def _global_exc(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check server logs for details."},
    )
