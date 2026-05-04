import asyncio
import logging
import os
import re
from typing import List, Literal, Optional

import requests
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from concurrent.futures import ThreadPoolExecutor
from core.ingestion import clone_repo, scan_files, cleanup_repo, IngestionError
from core.chunker import chunk_files_parallel
from core.embedder import embed_chunks
from core.vector_store import upsert_chunks, delete_namespace, namespace_exists
from core.retriever import retrieve
from core.llm import generate_answer, rewrite_query_with_history, LLMConfigError, LLMUnavailableError
from core.summarizer import generate_summary
from core.analyzer import analyze_structure
from core.jobs import job_store

logger = logging.getLogger(__name__)
router = APIRouter()

_GITHUB_URL_RE = re.compile(r"^https://github\.com/[\w.-]+/[\w.-]+(?:\.git)?/?$")


class AnalyzeRequest(BaseModel):
    repo_url: str

    @field_validator("repo_url")
    @classmethod
    def validate_github_url(cls, v: str) -> str:
        v = v.strip()
        if not _GITHUB_URL_RE.match(v):
            raise ValueError("repo_url must be a valid GitHub repository URL")
        return v


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be empty")
        return v


class AskRequest(BaseModel):
    question: str
    repo_url: str
    k: int = 5
    history: Optional[List[ChatTurn]] = None

    @field_validator("question")
    @classmethod
    def validate_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question must not be empty")
        if len(v) > 2000:
            raise ValueError("question must be under 2000 characters")
        return v

    @field_validator("k")
    @classmethod
    def validate_k(cls, v: int) -> int:
        if not (1 <= v <= 20):
            raise ValueError("k must be between 1 and 20")
        return v

    @field_validator("history")
    @classmethod
    def validate_history(cls, v: Optional[List[ChatTurn]]) -> Optional[List[ChatTurn]]:
        # Cap server-side too — defends against a runaway client.
        if v is not None and len(v) > 20:
            return v[-20:]
        return v


def _repo_namespace(repo_url: str) -> str:
    """Derive a stable Pinecone namespace from a repo URL."""
    tail = repo_url.rstrip("/").removesuffix(".git").split("github.com/", 1)[-1]
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", tail).strip("_")
    return sanitized or "default"


def _owner_repo(repo_url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a validated GitHub URL."""
    tail = repo_url.rstrip("/").removesuffix(".git").split("github.com/", 1)[-1]
    parts = tail.split("/")
    if len(parts) < 2:
        raise ValueError("Invalid GitHub URL")
    return parts[0], parts[1]


# -------------------- Background indexing --------------------

def _safe_summary(repo_path: str) -> str:
    """Generate the project summary, swallowing failures so they don't sink the job."""
    try:
        return generate_summary(repo_path)["summary"]
    except Exception as exc:
        logger.warning("Summary generation failed: %s", exc)
        return "(Summary unavailable — LLM call did not return in time.)"


def _run_indexing(job_id: str, repo_url: str) -> None:
    """Synchronous indexing pipeline. Executed in a worker thread."""
    namespace = _repo_namespace(repo_url)
    repo_path = None
    indexed_branch: str | None = None
    try:
        job_store.update(job_id, status="running", stage="cloning")
        repo_path = clone_repo(repo_url)
        # Capture which branch was actually checked out for the indexed snapshot.
        try:
            import git as _git
            indexed_branch = _git.Repo(repo_path).active_branch.name
        except Exception:
            indexed_branch = None

        job_store.update(job_id, stage="scanning")
        file_paths = scan_files(repo_path)
        if not file_paths:
            raise IngestionError("No supported source files found in repository.")

        job_store.update(job_id, stage="chunking")
        all_chunks = chunk_files_parallel(file_paths)
        if not all_chunks:
            raise IngestionError("No chunkable code found in repository.")

        # Kick off the LLM-bound summary in parallel — it has nothing to do with
        # embedding or indexing and is usually the longest single network call.
        with ThreadPoolExecutor(max_workers=2) as bg:
            summary_future = bg.submit(_safe_summary, repo_path)
            structure_future = bg.submit(analyze_structure, repo_path, file_paths)

            job_store.update(job_id, stage="embedding")
            embed_chunks(all_chunks)

            job_store.update(job_id, stage="indexing")
            delete_namespace(namespace)  # safe even if missing
            stored_count = upsert_chunks(all_chunks, namespace)

            job_store.update(job_id, stage="finalizing")
            structure_data = structure_future.result()
            summary = summary_future.result()

        job_store.update(
            job_id,
            status="completed",
            stage="done",
            result={
                "namespace": namespace,
                "repo_url": repo_url,
                "indexed_branch": indexed_branch,
                "files_indexed": len(file_paths),
                "chunks_stored": stored_count,
                "summary": summary,
                "structure": structure_data,
            },
        )

    except IngestionError as exc:
        logger.info("Indexing failed for %s: %s", repo_url, exc)
        job_store.update(job_id, status="failed", stage="error", error=str(exc))
    except Exception as exc:
        logger.exception("Unexpected indexing failure for %s", repo_url)
        job_store.update(job_id, status="failed", stage="error", error=f"{type(exc).__name__}: {exc}")
    finally:
        if repo_path:
            try:
                cleanup_repo(repo_path)
            except Exception as exc:
                logger.warning("Cleanup failed for %s: %s", repo_path, exc)


# -------------------- Endpoints --------------------

@router.post("/analyze")
async def analyze(request: AnalyzeRequest):
    """Kick off a background indexing job. Returns a job_id for polling."""
    # Fail-fast on private / nonexistent repos before spending minutes indexing.
    try:
        owner, repo = _owner_repo(request.repo_url)
    except ValueError:
        raise HTTPException(status_code=422, detail="Could not parse repo URL")
    try:
        check = await asyncio.to_thread(
            _gh_get, f"https://api.github.com/repos/{owner}/{repo}"
        )
    except requests.RequestException:
        check = None
    if check is not None and check.status_code == 404:
        raise HTTPException(status_code=404, detail=_private_repo_message(owner, repo))
    # 403 (rate-limited) → don't block analyze; clone may still succeed for public repos.

    job = job_store.create()
    # Run blocking pipeline in a worker thread so the event loop stays free
    asyncio.create_task(asyncio.to_thread(_run_indexing, job.id, request.repo_url))
    return {"job_id": job.id, "status": job.status}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    return job.to_dict()


@router.post("/ask")
async def ask(request: AskRequest):
    """Retrieve relevant code chunks and generate a grounded answer."""
    namespace = _repo_namespace(request.repo_url)

    if not namespace_exists(namespace):
        raise HTTPException(
            status_code=404,
            detail="This repository has not been indexed yet. Run /analyze first.",
        )

    history_payload = (
        [{"role": t.role, "content": t.content} for t in request.history]
        if request.history else None
    )

    # If there's prior turns, condense the follow-up into a self-contained query
    # so retrieval doesn't get a context-less "tell me more" or "show me that".
    # Rewrite is best-effort — a failure falls back to the literal question.
    search_query = request.question
    if history_payload:
        try:
            search_query = await asyncio.to_thread(
                rewrite_query_with_history, request.question, history_payload
            )
            if search_query != request.question:
                logger.info("Rewrote follow-up for retrieval: %r → %r", request.question, search_query)
        except Exception as exc:
            logger.warning("Query rewrite raised %s — using literal question", exc)
            search_query = request.question

    try:
        chunks = await asyncio.to_thread(retrieve, search_query, namespace, request.k)
    except Exception as exc:
        logger.exception("Retrieval failed")
        raise HTTPException(status_code=502, detail=f"Retrieval failed: {exc}") from exc

    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="No relevant code found for this question.",
        )

    try:
        result = await asyncio.to_thread(generate_answer, request.question, chunks, history_payload)
    except LLMConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Answer generation failed")
        raise HTTPException(status_code=502, detail=f"Answer generation failed: {exc}") from exc

    return result


# Allow file paths with most reasonable filename characters; block traversal.
_SAFE_PATH_RE = re.compile(r"^[\w./\- ()+@,'\[\]&]+$")
_SAFE_BRANCH_RE = re.compile(r"^[\w./\-]+$")
_MAX_FILE_BYTES = 1_000_000  # 1 MB cap on remotely-fetched file
_RAW_TIMEOUT_SECONDS = 15
_API_TIMEOUT_SECONDS = 10

# Caches keyed by (owner, repo). Tree cache also keyed by branch.
_default_branch_cache: dict[tuple[str, str], str] = {}
_branches_cache: dict[tuple[str, str], list[str]] = {}
_tree_cache: dict[tuple[str, str, str], dict] = {}


def _gh_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        # Optional — raises rate limit from 60/hour to 5000/hour
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _gh_get(url: str) -> requests.Response:
    return requests.get(url, headers=_gh_headers(), timeout=_API_TIMEOUT_SECONDS)


def _rate_limit_message() -> str:
    return (
        "Rate-limited by GitHub. Set GITHUB_TOKEN in backend/.env to raise the limit "
        "from 60/hour to 5000/hour, then restart the server."
    )


def _private_repo_message(owner: str, repo: str) -> str:
    return (
        f"Repository {owner}/{repo} is not publicly accessible. "
        f"CodeSage only supports public GitHub repositories. "
        f"If the repo URL is correct, make the repository public on GitHub and try again."
    )


def _resolve_default_branch(owner: str, repo: str) -> str | None:
    key = (owner, repo)
    if key in _default_branch_cache:
        return _default_branch_cache[key]
    try:
        res = _gh_get(f"https://api.github.com/repos/{owner}/{repo}")
        if res.status_code == 200:
            branch = res.json().get("default_branch")
            if branch:
                _default_branch_cache[key] = branch
                return branch
    except requests.RequestException as exc:
        logger.warning("GitHub API lookup failed for %s/%s: %s", owner, repo, exc)
    return None


def _list_branches(owner: str, repo: str) -> list[str]:
    """Return all branches for a repo (paginated, capped at 300)."""
    key = (owner, repo)
    if key in _branches_cache:
        return _branches_cache[key]

    branches: list[str] = []
    for page in range(1, 4):  # up to 3 pages × 100 = 300 branches
        try:
            res = _gh_get(
                f"https://api.github.com/repos/{owner}/{repo}/branches"
                f"?per_page=100&page={page}"
            )
        except requests.RequestException as exc:
            logger.warning("Branches lookup failed for %s/%s: %s", owner, repo, exc)
            break
        if res.status_code == 403:
            raise HTTPException(status_code=429, detail=_rate_limit_message())
        if res.status_code == 404:
            raise HTTPException(status_code=404, detail=_private_repo_message(owner, repo))
        if res.status_code != 200:
            raise HTTPException(
                status_code=res.status_code,
                detail=f"GitHub API returned {res.status_code} when listing branches.",
            )
        page_branches = [b["name"] for b in res.json()]
        branches.extend(page_branches)
        if len(page_branches) < 100:
            break

    _branches_cache[key] = branches
    return branches


def _fetch_tree(owner: str, repo: str, branch: str) -> dict:
    key = (owner, repo, branch)
    if key in _tree_cache:
        return _tree_cache[key]

    res = _gh_get(
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    )
    if res.status_code == 403:
        raise HTTPException(status_code=429, detail=_rate_limit_message())
    if res.status_code == 404:
        # Could be: branch doesn't exist, or repo is private and we can't see it.
        # Distinguish by probing the repo root via the same auth context.
        repo_check = _gh_get(f"https://api.github.com/repos/{owner}/{repo}")
        if repo_check.status_code == 404:
            raise HTTPException(status_code=404, detail=_private_repo_message(owner, repo))
        raise HTTPException(status_code=404, detail=f"Branch {branch!r} not found in {owner}/{repo}.")
    if res.status_code != 200:
        raise HTTPException(
            status_code=res.status_code,
            detail=f"GitHub API returned {res.status_code} when fetching tree.",
        )

    data = res.json()
    entries = [
        {"path": e["path"], "type": e["type"], "size": e.get("size", 0)}
        for e in data.get("tree", [])
    ]
    result = {
        "branch": branch,
        "entries": entries,
        "truncated": data.get("truncated", False),
    }
    _tree_cache[key] = result
    return result


@router.get("/branches")
async def list_branches(repo_url: str = Query(...)):
    """Return all branches for a repo plus the default branch name."""
    if not _GITHUB_URL_RE.match(repo_url.strip()):
        raise HTTPException(status_code=422, detail="Invalid repo_url")
    try:
        owner, repo = _owner_repo(repo_url.strip())
    except ValueError:
        raise HTTPException(status_code=422, detail="Could not parse repo URL")

    branches = await asyncio.to_thread(_list_branches, owner, repo)
    default_branch = await asyncio.to_thread(_resolve_default_branch, owner, repo)
    return {"default_branch": default_branch, "branches": branches}


@router.get("/tree")
async def get_tree(
    repo_url: str = Query(...),
    branch: str = Query(..., description="Branch name to load the tree for"),
):
    """Return the recursive file tree for a given branch."""
    if not _GITHUB_URL_RE.match(repo_url.strip()):
        raise HTTPException(status_code=422, detail="Invalid repo_url")
    if not _SAFE_BRANCH_RE.match(branch):
        raise HTTPException(status_code=422, detail="Invalid branch name")
    try:
        owner, repo = _owner_repo(repo_url.strip())
    except ValueError:
        raise HTTPException(status_code=422, detail="Could not parse repo URL")
    return await asyncio.to_thread(_fetch_tree, owner, repo, branch)


@router.get("/file")
async def get_file(
    repo_url: str = Query(..., description="GitHub repository URL"),
    path: str = Query(..., description="File path within the repo"),
    branch: str | None = Query(None, description="Branch name; falls back to default if omitted"),
):
    """Stream a single file's contents from GitHub raw."""
    if not _GITHUB_URL_RE.match(repo_url.strip()):
        raise HTTPException(status_code=422, detail="Invalid repo_url")
    if ".." in path or path.startswith("/") or not _SAFE_PATH_RE.match(path):
        raise HTTPException(status_code=422, detail="Invalid file path")
    if branch is not None and not _SAFE_BRANCH_RE.match(branch):
        raise HTTPException(status_code=422, detail="Invalid branch name")

    try:
        owner, repo = _owner_repo(repo_url.strip())
    except ValueError:
        raise HTTPException(status_code=422, detail="Could not parse repo URL")

    # Build candidate branches: explicit > default > main > master
    branches: list[str] = []
    if branch:
        branches.append(branch)
    else:
        default_branch = await asyncio.to_thread(_resolve_default_branch, owner, repo)
        if default_branch:
            branches.append(default_branch)
        for fallback in ("main", "master"):
            if fallback not in branches:
                branches.append(fallback)

    last_status = 404
    for b in branches:
        url = f"https://raw.githubusercontent.com/{owner}/{repo}/{b}/{path}"
        try:
            res = await asyncio.to_thread(
                requests.get, url, timeout=_RAW_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            logger.warning("Raw fetch failed for %s: %s", url, exc)
            continue
        if res.status_code == 200:
            content = res.content[:_MAX_FILE_BYTES]
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                raise HTTPException(status_code=415, detail="File is not UTF-8 text")
            truncated = len(res.content) > _MAX_FILE_BYTES
            return {
                "path": path,
                "branch": b,
                "content": text,
                "truncated": truncated,
                "size_bytes": len(content),
            }
        last_status = res.status_code

    if branch:
        raise HTTPException(
            status_code=last_status,
            detail=f"File {path!r} not found on branch {branch!r}.",
        )
    raise HTTPException(
        status_code=last_status,
        detail=(
            f"File {path!r} not found on any tried branch ({', '.join(branches)}). "
            f"{_rate_limit_message()}"
        ),
    )
