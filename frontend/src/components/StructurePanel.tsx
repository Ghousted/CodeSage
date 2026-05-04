import { useEffect, useState } from "react";
import { getBranches, getTree } from "../api/client";
import type { AnalyzeResult, BranchesResponse, TreeResponse } from "../api/client";
import FileTree from "./FileTree";

interface Props {
  result: AnalyzeResult;
  repoUrl: string;
  selectedFile?: string | null;
}

export default function StructurePanel({ result, repoUrl, selectedFile }: Props) {
  const indexedBranch = result.indexed_branch;
  const lang = result.structure.language_breakdown;

  const [branches, setBranches] = useState<BranchesResponse | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(indexedBranch);

  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setBranchesError(null);
    getBranches(repoUrl, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setBranches(data);
        if (!selectedBranch) {
          setSelectedBranch(data.default_branch ?? data.branches[0] ?? null);
        }
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setBranchesError(err instanceof Error ? err.message : "Could not load branches");
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl]);

  useEffect(() => {
    if (!selectedBranch) return;
    const ac = new AbortController();
    setTreeLoading(true);
    setTreeError(null);
    setTree(null);
    getTree(repoUrl, selectedBranch, ac.signal)
      .then((data) => { if (!ac.signal.aborted) setTree(data); })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setTreeError(err instanceof Error ? err.message : "Could not load tree");
      })
      .finally(() => { if (!ac.signal.aborted) setTreeLoading(false); });
    return () => ac.abort();
  }, [repoUrl, selectedBranch]);

  const fileCount = tree ? tree.entries.filter((e) => e.type === "blob").length : null;
  const folderCount = tree ? tree.entries.filter((e) => e.type === "tree").length : null;
  const onDifferentBranch = !!selectedBranch && !!indexedBranch && selectedBranch !== indexedBranch;

  return (
    <div style={styles.panel}>
      {/* Top toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.branchControl}>
          <BranchIcon />
          <select
            value={selectedBranch ?? ""}
            onChange={(e) => setSelectedBranch(e.target.value)}
            disabled={!branches || branchesError != null}
            style={styles.select}
            aria-label="Branch"
          >
            {!branches && <option>Loading branches…</option>}
            {branches?.branches.map((b) => (
              <option key={b} value={b}>
                {b}
                {b === branches.default_branch ? "  (default)" : ""}
                {b === indexedBranch ? "  · indexed" : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.statRow}>
          {fileCount !== null && (
            <>
              <Stat label="Files" value={String(fileCount)} />
              <Stat label="Folders" value={String(folderCount)} />
            </>
          )}
          <div style={styles.langStrip}>
            {Object.entries(lang).slice(0, 4).map(([l, count]) => (
              <span key={l} style={styles.langPill}>
                {l} <span style={styles.langCount}>{count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {branchesError && (
        <div style={styles.errorBanner}>
          <span style={styles.errorIcon}>!</span>
          <span>{branchesError}</span>
        </div>
      )}

      {onDifferentBranch && (
        <div style={styles.notice}>
          <span style={styles.noticeIcon}>i</span>
          <span>
            Browsing branch <strong>{selectedBranch}</strong>. Q&A still answers from the
            indexed snapshot of <strong>{indexedBranch}</strong>. Re-analyze to ground
            answers in a different branch.
          </span>
        </div>
      )}

      {/* Tree */}
      <div style={styles.treeWrap}>
        {treeLoading && <SkeletonTree />}
        {treeError && (
          <div style={styles.errorBanner}>
            <span style={styles.errorIcon}>!</span>
            <span>{treeError}</span>
          </div>
        )}
        {tree && (
          <>
            {tree.truncated && (
              <p style={styles.truncated}>
                Tree truncated by GitHub for very large repos. Some files may not appear.
              </p>
            )}
            <FileTree repoUrl={repoUrl} branch={tree.branch} entries={tree.entries} selectedFile={selectedFile} />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statValue}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

function SkeletonTree() {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {[40, 60, 75, 50, 65, 45, 70, 55, 80, 60].map((w, i) => (
        <li
          key={i}
          style={{
            ...styles.skelRow,
            paddingLeft: 8 + (i % 3) * 14,
          }}
        >
          <span style={{ ...styles.skelBar, width: 14 }} />
          <span style={{ ...styles.skelBar, width: `${w}%` }} />
        </li>
      ))}
    </ul>
  );
}

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden style={{ color: "var(--text-muted)" }}>
      <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 },

  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottom: "1px solid var(--border-subtle)",
  },

  branchControl: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "0 10px 0 12px",
  },
  select: {
    background: "transparent",
    color: "var(--text)",
    border: "none",
    padding: "8px 4px",
    fontSize: 13,
    fontFamily: "inherit",
    minWidth: 200,
    cursor: "pointer",
    outline: "none",
  },

  statRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  stat: { display: "flex", flexDirection: "column", lineHeight: 1.1 },
  statValue: { fontSize: 14, fontWeight: 600, color: "var(--text)" },
  statLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },

  langStrip: { display: "flex", flexWrap: "wrap", gap: 6 },
  langPill: {
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-pill)",
    padding: "2px 10px",
  },
  langCount: { color: "var(--text)", fontWeight: 600 },

  errorBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "rgba(248, 81, 73, 0.08)",
    border: "1px solid rgba(248, 81, 73, 0.4)",
    borderRadius: "var(--r-md)",
    padding: "10px 12px",
    color: "var(--text)",
    fontSize: 13,
  },
  errorIcon: {
    flexShrink: 0,
    width: 18, height: 18,
    borderRadius: "50%",
    background: "var(--error)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 11,
  },

  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    background: "rgba(88, 166, 255, 0.06)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--accent)",
    borderRadius: "var(--r-md)",
    padding: "10px 12px",
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  noticeIcon: {
    flexShrink: 0,
    width: 18, height: 18,
    borderRadius: "50%",
    background: "rgba(88, 166, 255, 0.2)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    fontStyle: "italic",
    fontWeight: 700,
    fontSize: 11,
    fontFamily: "Georgia, serif",
  },

  treeWrap: {
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    padding: 6,
    minHeight: 200,
    flex: 1,
    overflowY: "auto",
  },

  truncated: {
    background: "var(--surface)",
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "8px 12px",
    borderRadius: "var(--r-sm)",
    marginBottom: 6,
    border: "1px solid var(--border)",
  },

  skelRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
  },
  skelBar: {
    height: 10,
    borderRadius: 4,
    background: "linear-gradient(90deg, var(--surface-3) 0%, var(--surface-2) 50%, var(--surface-3) 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer-bg 1.4s ease-in-out infinite",
    display: "inline-block",
  },
};
