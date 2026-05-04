import { useEffect, useRef, useState } from "react";
import type { AnalyzeResult, Job } from "../api/client";
import { analyzeAndWait } from "../api/client";

interface Props {
  onAnalyzed: (repoUrl: string, result: AnalyzeResult) => void;
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/;

const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  cloning: "Cloning repository",
  scanning: "Scanning files",
  chunking: "Parsing source code",
  embedding: "Generating embeddings",
  indexing: "Building vector index",
  analyzing: "Analyzing structure",
  summarizing: "Writing summary",
  finalizing: "Finalizing",
  done: "Done",
  error: "Failed",
  starting: "Starting up",
};

export default function RepoInput({ onAnalyzed }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!loading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [loading]);

  const trimmedUrl = url.trim();
  const looksValid = GITHUB_URL_RE.test(trimmedUrl);
  const showInvalidHint = !!trimmedUrl && !looksValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!looksValid || loading) return;
    setError(null);
    setStage("starting");
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const result = await analyzeAndWait(
        trimmedUrl,
        (job: Job) => setStage(job.stage),
        abortRef.current.signal,
      );
      onAnalyzed(trimmedUrl, result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setStage(null);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  const stageLabel = stage ? STAGE_LABELS[stage] ?? stage : "Starting up";

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <label htmlFor="repo-url" style={styles.label}>
        GitHub repository URL
      </label>
      <div style={styles.inputRow}>
        <span style={styles.inputPrefix}>
          <GitHubIcon />
        </span>
        <input
          id="repo-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          required
          disabled={loading}
          autoFocus
          style={{
            ...styles.input,
            borderColor: showInvalidHint ? "var(--error)" : "var(--border)",
          }}
        />
        {loading ? (
          <button type="button" onClick={cancel} style={styles.cancelBtn}>
            Cancel
          </button>
        ) : (
          <button type="submit" disabled={!looksValid} style={styles.submitBtn}>
            Analyze
            <span style={styles.btnArrow}>→</span>
          </button>
        )}
      </div>

      {showInvalidHint && (
        <p style={styles.hint}>
          Please use the full URL: <code style={styles.code}>https://github.com/owner/repo</code>
        </p>
      )}
      {error && (
        <div style={styles.errorBanner} role="alert">
          <span style={styles.errorIcon}>!</span>
          <span style={styles.errorText}>{error}</span>
        </div>
      )}

      {loading && (
        <div style={styles.banner} role="status" aria-live="polite">
          <div style={styles.bannerHeader}>
            <span style={styles.dot} aria-hidden />
            <strong style={styles.bannerStage}>{stageLabel}…</strong>
            <span style={styles.bannerSpacer} />
            <button type="button" onClick={cancel} style={styles.bannerCancel}>
              Cancel
            </button>
          </div>
          <ProgressBar stage={stage} />
          <p style={styles.bannerNote}>
            <strong>Heads up:</strong> keep this tab open and focused. Switching tabs,
            refreshing, or closing the page will abandon the job.
          </p>
        </div>
      )}
    </form>
  );
}

function ProgressBar({ stage }: { stage: string | null }) {
  const order = ["cloning", "scanning", "chunking", "embedding", "indexing", "finalizing", "done"];
  const idx = stage ? order.indexOf(stage) : -1;
  const pct = idx >= 0 ? Math.max(8, ((idx + 1) / order.length) * 100) : 4;
  return (
    <div style={styles.progressTrack}>
      <div style={{ ...styles.progressFill, width: `${pct}%` }} />
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { width: "100%", display: "flex", flexDirection: "column", gap: 10 },
  label: {
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
  },

  inputRow: {
    display: "flex",
    alignItems: "stretch",
    gap: 8,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: 4,
    transition: "border-color var(--t-fast)",
  },
  inputPrefix: {
    display: "flex",
    alignItems: "center",
    paddingLeft: 12,
    color: "var(--text-muted)",
  },
  input: {
    flex: 1,
    padding: "10px 4px",
    background: "transparent",
    border: "none",
    color: "var(--text)",
    fontSize: 14,
    outline: "none",
  },
  submitBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 18px",
    background: "var(--accent)",
    color: "#0b0f15",
    border: "none",
    borderRadius: "var(--r-sm)",
    fontWeight: 600,
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  cancelBtn: {
    padding: "0 18px",
    background: "var(--surface-3)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-sm)",
    fontWeight: 500,
    fontSize: 14,
    whiteSpace: "nowrap",
  },
  btnArrow: { fontSize: 14, opacity: 0.85 },
  hint: { color: "var(--text-muted)", fontSize: 12 },
  code: {
    fontFamily: "var(--mono)",
    fontSize: 11,
    background: "var(--surface-2)",
    padding: "1px 6px",
    borderRadius: 4,
    color: "var(--accent)",
  },

  errorBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "rgba(248, 81, 73, 0.08)",
    border: "1px solid rgba(248, 81, 73, 0.4)",
    borderRadius: "var(--r-md)",
    padding: "10px 12px",
  },
  errorIcon: {
    flexShrink: 0,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "var(--error)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 12,
  },
  errorText: { color: "var(--text)", fontSize: 13, lineHeight: 1.5 },

  banner: {
    padding: 16,
    background:
      "linear-gradient(180deg, rgba(88, 166, 255, 0.1), rgba(163, 113, 247, 0.04))",
    border: "1px solid rgba(88, 166, 255, 0.4)",
    borderRadius: "var(--r-md)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  bannerHeader: { display: "flex", alignItems: "center", gap: 10 },
  dot: {
    width: 8, height: 8, borderRadius: "50%",
    background: "var(--accent)",
    animation: "pulse 1.2s ease-in-out infinite",
    flexShrink: 0,
  },
  bannerStage: { color: "var(--accent)", fontSize: 13, fontWeight: 600 },
  bannerSpacer: { flex: 1 },
  bannerCancel: {
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-sm)",
    padding: "4px 12px",
    fontSize: 12,
  },
  bannerNote: { color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, margin: 0 },

  progressTrack: {
    height: 4,
    background: "var(--surface-3)",
    borderRadius: "var(--r-pill)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
    backgroundSize: "200% 100%",
    transition: "width 320ms cubic-bezier(0.4, 0, 0.2, 1)",
    animation: "shimmer-bg 3s ease-in-out infinite",
  },
};
