"""In-memory job tracker for long-running indexing tasks.

This is single-process / single-worker.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Optional


@dataclass
class Job:
    id: str
    status: str = "pending"  # pending | running | completed | failed
    stage: str = "queued"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class JobStore:
    """Thread-safe in-memory job store with TTL eviction."""

    def __init__(self, ttl_seconds: int = 3600):
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds

    def create(self) -> Job:
        job = Job(id=str(uuid.uuid4()))
        with self._lock:
            self._gc_locked()
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for k, v in fields.items():
                setattr(job, k, v)
            job.updated_at = time.time()

    def _gc_locked(self) -> None:
        cutoff = time.time() - self._ttl
        stale = [jid for jid, j in self._jobs.items() if j.updated_at < cutoff]
        for jid in stale:
            del self._jobs[jid]


job_store = JobStore()
