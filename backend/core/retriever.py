from typing import List, Dict, Any
from core.embedder import embed_query
from core.vector_store import similarity_search


def retrieve(question: str, namespace: str, k: int = 5) -> List[Dict[str, Any]]:
    """
    Embed the question and return the top-k most relevant code chunks
    with diversity: deduplicate by file_path so results span multiple files.
    """
    query_embedding = embed_query(question)

    # Fetch more candidates then deduplicate to maximize source diversity
    candidates = similarity_search(query_embedding, namespace, k=k * 3)

    seen_files: set[str] = set()
    diverse_results: List[Dict[str, Any]] = []

    for candidate in candidates:
        file_path = candidate["metadata"].get("file_path", "")
        if file_path not in seen_files:
            seen_files.add(file_path)
            diverse_results.append(candidate)
        else:
            # Allow a second chunk from the same file only if we haven't filled k yet
            if len(diverse_results) < k // 2:
                diverse_results.append(candidate)

        if len(diverse_results) >= k:
            break

    return diverse_results
