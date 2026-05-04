import logging
import os
import threading
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

_model_instance: SentenceTransformer | None = None
_model_lock = threading.Lock()


def _detect_device() -> str:
    """Pick the fastest available device: CUDA > MPS (Apple Silicon) > CPU."""
    override = os.getenv("EMBEDDING_DEVICE")
    if override:
        return override
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _default_batch_size(device: str) -> int:
    # GPUs eat much larger batches; CPU does best around 32-64.
    if device in ("cuda", "mps"):
        return 128
    return 64


def _get_model() -> SentenceTransformer:
    global _model_instance
    if _model_instance is not None:
        return _model_instance
    with _model_lock:
        if _model_instance is None:
            model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
            device = _detect_device()
            logger.info("Loading embedding model %r on device=%s", model_name, device)
            _model_instance = SentenceTransformer(model_name, device=device)
    return _model_instance


def warmup() -> None:
    """Pre-load the embedding model so first request is not penalized."""
    _get_model()


def get_dimension() -> int:
    return _get_model().get_sentence_embedding_dimension()


def embed_chunks(chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add 'embedding' key to each chunk in-place and return the list."""
    if not chunks:
        return chunks
    model = _get_model()
    device = model.device.type if hasattr(model, "device") else "cpu"
    batch_size = int(os.getenv("EMBEDDING_BATCH_SIZE", _default_batch_size(device)))

    texts = [(chunk["content"] or "").strip() or " " for chunk in chunks]
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
        normalize_embeddings=True,  # cosine-similarity friendly + slightly faster downstream
    )
    for chunk, embedding in zip(chunks, embeddings):
        chunk["embedding"] = embedding.tolist()
    return chunks


def embed_query(query: str) -> List[float]:
    if not query or not query.strip():
        raise ValueError("Cannot embed empty query")
    model = _get_model()
    return model.encode(query.strip(), convert_to_numpy=True, normalize_embeddings=True).tolist()
