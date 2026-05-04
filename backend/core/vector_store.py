import logging
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any
from pinecone import Pinecone, ServerlessSpec
from pinecone.exceptions import NotFoundException, PineconeApiException

logger = logging.getLogger(__name__)

_pinecone_client: Pinecone | None = None
_index = None

# Pinecone hard limit is 40KB per vector metadata. Leave headroom for keys + other fields.
MAX_METADATA_CONTENT_BYTES = 30_000
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0


def _get_index():
    global _pinecone_client, _index
    if _index is not None:
        return _index

    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        raise RuntimeError("PINECONE_API_KEY is not set")
    index_name = os.getenv("PINECONE_INDEX_NAME", "codesage")

    _pinecone_client = Pinecone(api_key=api_key)

    # Read dimension from the active embedding model so swapping EMBEDDING_MODEL
    # (e.g. to a code-aware model) doesn't require manual code changes.
    from core.embedder import get_dimension
    dim = get_dimension()

    existing = {i.name: i for i in _pinecone_client.list_indexes()}
    if index_name in existing:
        existing_dim = existing[index_name].dimension
        if existing_dim != dim:
            raise RuntimeError(
                f"Pinecone index {index_name!r} has dimension {existing_dim} but the active "
                f"embedding model produces {dim}-dim vectors. Either change EMBEDDING_MODEL "
                f"back, or delete the existing index and re-run /analyze."
            )
    else:
        logger.info("Creating Pinecone index %r (dim=%d)", index_name, dim)
        _pinecone_client.create_index(
            name=index_name,
            dimension=dim,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        # Wait for the index to be ready before using it
        for _ in range(30):
            description = _pinecone_client.describe_index(index_name)
            if description.status.get("ready"):
                break
            time.sleep(1)

    _index = _pinecone_client.Index(index_name)
    return _index


def _truncate_for_metadata(content: str) -> str:
    """Pinecone caps metadata at 40KB total per vector — clip oversized chunks."""
    encoded = content.encode("utf-8", errors="ignore")
    if len(encoded) <= MAX_METADATA_CONTENT_BYTES:
        return content
    truncated = encoded[:MAX_METADATA_CONTENT_BYTES].decode("utf-8", errors="ignore")
    return truncated + "\n... [truncated]"


def _retry(fn, *, op: str):
    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except (PineconeApiException, ConnectionError) as exc:
            last_err = exc
            wait = RETRY_BACKOFF_SECONDS * attempt
            logger.warning("Pinecone %s failed (attempt %d/%d): %s — retrying in %.1fs",
                           op, attempt, MAX_RETRIES, exc, wait)
            time.sleep(wait)
    raise RuntimeError(f"Pinecone {op} failed after {MAX_RETRIES} attempts: {last_err}")


def upsert_chunks(chunks: List[Dict[str, Any]], namespace: str) -> int:
    """Store embedded chunks into Pinecone under the given namespace."""
    if not chunks:
        return 0

    index = _get_index()
    vectors = []
    for chunk in chunks:
        if "embedding" not in chunk:
            continue
        vector_id = str(uuid.uuid4())
        # Filter out None values — Pinecone metadata rejects them
        clean_meta = {k: v for k, v in chunk["metadata"].items() if v is not None}
        clean_meta["content"] = _truncate_for_metadata(chunk["content"])
        vectors.append({"id": vector_id, "values": chunk["embedding"], "metadata": clean_meta})

    if not vectors:
        return 0

    # Pinecone recommends batches of 100. Upload several batches concurrently so
    # we're not bottlenecked on round-trip latency.
    batch_size = 100
    batches = [vectors[i : i + batch_size] for i in range(0, len(vectors), batch_size)]
    workers = min(8, max(1, len(batches)))

    def _upload(batch: List[Dict[str, Any]]) -> None:
        _retry(lambda: index.upsert(vectors=batch, namespace=namespace), op="upsert")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        # list() forces all to complete and re-raises any exception
        list(pool.map(_upload, batches))

    return len(vectors)


def similarity_search(query_embedding: List[float], namespace: str, k: int = 5) -> List[Dict[str, Any]]:
    """Return top-k chunks most similar to the query embedding."""
    index = _get_index()
    response = _retry(
        lambda: index.query(
            vector=query_embedding,
            top_k=k,
            namespace=namespace,
            include_metadata=True,
        ),
        op="query",
    )
    results = []
    for match in response.matches:
        results.append({
            "score": match.score,
            "content": match.metadata.get("content", ""),
            "metadata": {k: v for k, v in match.metadata.items() if k != "content"},
        })
    return results


def namespace_exists(namespace: str) -> bool:
    """Check whether a namespace currently has any vectors."""
    index = _get_index()
    try:
        stats = index.describe_index_stats()
        return namespace in (stats.get("namespaces") or {})
    except PineconeApiException as exc:
        logger.warning("describe_index_stats failed: %s", exc)
        return False


def delete_namespace(namespace: str) -> None:
    """Remove all vectors for a given namespace. Safe to call when namespace is missing."""
    if not namespace_exists(namespace):
        return
    index = _get_index()
    try:
        index.delete(delete_all=True, namespace=namespace)
    except NotFoundException:
        # Race: namespace was empty / deleted between the check and the call
        pass
    except PineconeApiException as exc:
        logger.warning("delete_namespace(%s) failed: %s", namespace, exc)
