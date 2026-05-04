// In dev, requests go to "/api" and the Vite proxy forwards them to localhost:8000.
// In prod, set VITE_API_BASE_URL to the deployed backend's full origin
// (e.g. https://username-codesage.hf.space). The "/api" suffix is appended below.
const API_ORIGIN = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
const BASE = `${API_ORIGIN}/api`;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface FileRecord {
  path: string;
  size_bytes: number;
  import_count?: number;
}

export interface AnalyzeResult {
  namespace: string;
  repo_url: string;
  indexed_branch: string | null;
  files_indexed: number;
  chunks_stored: number;
  summary: string;
  structure: {
    total_files: number;
    language_breakdown: Record<string, number>;
    structure: {
      entry_points: FileRecord[];
      config_files: FileRecord[];
      api_routes: FileRecord[];
      db_models: FileRecord[];
      other_key_files: FileRecord[];
    };
  };
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  stage: string;
  created_at: number;
  updated_at: number;
  result: AnalyzeResult | null;
  error: string | null;
}

export interface AnalyzeStartResponse {
  job_id: string;
  status: JobStatus;
}

export interface ChunkUsed {
  file_path: string;
  function_name: string | null;
  content: string;
  score: number | null;
}

export interface AskResponse {
  answer: string;
  source_files: string[];
  chunks_used: ChunkUsed[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const message = (data && (data.detail || data.message)) || res.statusText;
      throw new ApiError(typeof message === "string" ? message : "Request failed", res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ApiError("Request timed out or was cancelled.", 408);
    }
    throw new ApiError((err as Error).message || "Network error", 0);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startAnalyze(repoUrl: string, signal?: AbortSignal): Promise<AnalyzeStartResponse> {
  return request<AnalyzeStartResponse>(
    "/analyze",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_url: repoUrl }),
    },
    15_000,
    signal,
  );
}

export function getJob(jobId: string, signal?: AbortSignal): Promise<Job> {
  return request<Job>(`/jobs/${jobId}`, { method: "GET" }, 10_000, signal);
}

export interface FileContents {
  path: string;
  branch: string;
  content: string;
  truncated: boolean;
  size_bytes: number;
}

export interface BranchesResponse {
  default_branch: string | null;
  branches: string[];
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size: number;
}

export interface TreeResponse {
  branch: string;
  entries: TreeEntry[];
  truncated: boolean;
}

export function getFile(
  repoUrl: string,
  path: string,
  branch?: string,
  signal?: AbortSignal,
): Promise<FileContents> {
  const params: Record<string, string> = { repo_url: repoUrl, path };
  if (branch) params.branch = branch;
  const qs = new URLSearchParams(params);
  return request<FileContents>(`/file?${qs.toString()}`, { method: "GET" }, 30_000, signal);
}

export function getBranches(repoUrl: string, signal?: AbortSignal): Promise<BranchesResponse> {
  const qs = new URLSearchParams({ repo_url: repoUrl });
  return request<BranchesResponse>(`/branches?${qs.toString()}`, { method: "GET" }, 15_000, signal);
}

export function getTree(repoUrl: string, branch: string, signal?: AbortSignal): Promise<TreeResponse> {
  const qs = new URLSearchParams({ repo_url: repoUrl, branch });
  return request<TreeResponse>(`/tree?${qs.toString()}`, { method: "GET" }, 30_000, signal);
}

export function askQuestion(
  question: string,
  repoUrl: string,
  k: number = 5,
  history: ChatTurn[] = [],
  signal?: AbortSignal,
): Promise<AskResponse> {
  return request<AskResponse>(
    "/ask",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, repo_url: repoUrl, k, history }),
    },
    120_000, // LLM calls can be slow
    signal,
  );
}

/**
 * Start an analyze job and poll until it completes or fails.
 * Resolves with the final result; rejects with a meaningful error.
 */
export async function analyzeAndWait(
  repoUrl: string,
  onProgress: (job: Job) => void,
  signal?: AbortSignal,
): Promise<AnalyzeResult> {
  const { job_id } = await startAnalyze(repoUrl, signal);
  const POLL_INTERVAL_MS = 1500;
  const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes
  const start = Date.now();

  // Poll
  while (true) {
    if (signal?.aborted) throw new ApiError("Cancelled by user.", 0);
    if (Date.now() - start > MAX_DURATION_MS) {
      throw new ApiError("Indexing took too long and was abandoned.", 504);
    }

    const job = await getJob(job_id, signal);
    onProgress(job);

    if (job.status === "completed" && job.result) return job.result;
    if (job.status === "failed") throw new ApiError(job.error ?? "Indexing failed", 500);

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export { ApiError };
