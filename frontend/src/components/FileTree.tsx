import { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { getFile } from "../api/client";
import type { FileContents, TreeEntry } from "../api/client";

interface Node {
  name: string;
  path: string;
  type: "tree" | "blob";
  size: number;
  children: Node[];
}

interface Props {
  repoUrl: string;
  branch: string;
  entries: TreeEntry[];
  selectedFile?: string | null;
}

/** Build a nested folder/file tree from GitHub's flat tree listing. */
function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: "", path: "", type: "tree", size: 0, children: [] };

  const byPath = new Map<string, Node>();
  byPath.set("", root);

  // Sort so parent dirs are created before children (defensive — GitHub already does this)
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const e of sorted) {
    if (e.type === "commit") continue; // submodules — skip for now
    const parts = e.path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parent = byPath.get(parentPath) ?? root;

    const node: Node = {
      name,
      path: e.path,
      type: e.type === "tree" ? "tree" : "blob",
      size: e.size ?? 0,
      children: [],
    };
    parent.children.push(node);
    if (node.type === "tree") byPath.set(e.path, node);
  }

  // Sort each level: folders first, then files, alphabetical
  const sortChildren = (n: Node) => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortChildren);
  };
  sortChildren(root);

  return root.children;
}

export default function FileTree({ repoUrl, branch, entries, selectedFile }: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedFile]);

  return (
    <ul style={styles.rootList}>
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          repoUrl={repoUrl}
          branch={branch}
          defaultExpanded={true}
          selectedFile={selectedFile}
          selectedRef={selectedFile ? selectedRef : undefined}
          isAncestorOfSelected={selectedFile ? selectedFile.startsWith(node.path + "/") : false}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  depth,
  repoUrl,
  branch,
  defaultExpanded = false,
  selectedFile,
  selectedRef,
  isAncestorOfSelected = false,
}: {
  node: Node;
  depth: number;
  repoUrl: string;
  branch: string;
  defaultExpanded?: boolean;
  selectedFile?: string | null;
  selectedRef?: React.RefObject<HTMLButtonElement>;
  isAncestorOfSelected?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || isAncestorOfSelected);

  if (node.type === "tree") {
    return (
      <li style={styles.li}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ ...styles.row, paddingLeft: 8 + depth * 14 }}
          aria-expanded={expanded}
        >
          <span style={styles.chevron}>{expanded ? "▾" : "▸"}</span>
          <span style={styles.folderIcon}>📁</span>
          <span style={styles.folderName}>{node.name}</span>
          <span style={styles.spacer} />
          <span style={styles.metaMuted}>{node.children.length}</span>
        </button>
        {expanded && (
          <ul style={styles.childList}>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                repoUrl={repoUrl}
                branch={branch}
                defaultExpanded={false}
                selectedFile={selectedFile}
                selectedRef={selectedFile && child.path === selectedFile ? selectedRef : undefined}
                isAncestorOfSelected={selectedFile ? selectedFile.startsWith(child.path + "/") : false}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <FileLeaf
      node={node}
      depth={depth}
      repoUrl={repoUrl}
      branch={branch}
      selectedFile={selectedFile}
      selectedRef={selectedFile === node.path ? selectedRef : undefined}
      isSelected={selectedFile === node.path}
    />
  );
}

function FileLeaf({
  node,
  depth,
  repoUrl,
  branch,
  selectedFile,
  selectedRef,
  isSelected = false,
}: {
  node: Node;
  depth: number;
  repoUrl: string;
  branch: string;
  selectedFile?: string | null;
  selectedRef?: React.RefObject<HTMLButtonElement>;
  isSelected?: boolean;
}) {
  const [open, setOpen] = useState(isSelected);
  const [content, setContent] = useState<FileContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // Reset fetched-state when we move to a different branch / file identity
  useEffect(() => {
    fetchedRef.current = false;
    setContent(null);
    setError(null);
  }, [repoUrl, branch, node.path]);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    getFile(repoUrl, node.path, branch, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setContent(data);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load file");
        fetchedRef.current = false;
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, repoUrl, branch, node.path]);

  return (
    <li style={styles.li}>
      <button
        ref={isSelected ? selectedRef : undefined}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...styles.row,
          paddingLeft: 8 + depth * 14,
          ...(isSelected ? styles.selectedFile : {}),
        }}
        aria-expanded={open}
      >
        <span style={styles.chevron}>{open ? "▾" : "▸"}</span>
        <span style={styles.fileIcon}>📄</span>
        <span style={styles.fileName}>{node.name}</span>
        <span style={styles.spacer} />
        <span style={styles.metaMuted}>{formatSize(node.size)}</span>
      </button>

      {open && (
        <div style={{ ...styles.viewer, marginLeft: 8 + depth * 14 }}>
          {loading && <p style={styles.placeholder}>Loading…</p>}
          {error && <p style={styles.errorText}>{error}</p>}
          {content && (
            <>
              {content.truncated && (
                <p style={styles.truncated}>File truncated at 1 MB. Showing first portion.</p>
              )}
              <SyntaxHighlighter
                language={detectLanguage(node.name)}
                style={vscDarkPlus}
                customStyle={styles.code}
                showLineNumbers
                wrapLongLines
              >
                {content.content}
              </SyntaxHighlighter>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: "python", js: "javascript", ts: "typescript",
    jsx: "jsx", tsx: "tsx", json: "json", md: "markdown",
    yml: "yaml", yaml: "yaml", toml: "toml", html: "html",
    css: "css", scss: "scss", sh: "bash", rs: "rust",
    go: "go", java: "java", rb: "ruby", php: "php",
  };
  return map[ext ?? ""] ?? "text";
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const styles: Record<string, React.CSSProperties> = {
  rootList: { listStyle: "none", padding: 0, margin: 0 },
  childList: { listStyle: "none", padding: 0, margin: 0 },
  li: { listStyle: "none" },
  row: {
    width: "100%",
    background: "transparent",
    border: "none",
    color: "inherit",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    borderRadius: 4,
  },
  chevron: { fontSize: 10, color: "var(--text-muted)", width: 10 },
  folderIcon: { fontSize: 13 },
  fileIcon: { fontSize: 12, opacity: 0.7 },
  folderName: { fontSize: 13, color: "var(--text)", fontWeight: 500 },
  fileName: { fontSize: 12, color: "var(--text)", fontFamily: "var(--mono)" },
  spacer: { flex: 1 },
  metaMuted: { fontSize: 10, color: "var(--text-muted)" },
  viewer: {
    marginTop: 4,
    marginBottom: 8,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg)",
    overflow: "hidden",
    maxHeight: 480,
    overflowY: "auto",
  },
  code: { margin: 0, fontSize: 12, background: "transparent" },
  placeholder: { padding: 12, color: "var(--text-muted)", fontSize: 13 },
  errorText: { padding: 12, color: "var(--error)", fontSize: 13 },
  truncated: {
    padding: "6px 12px",
    background: "var(--surface-2)",
    color: "var(--text-muted)",
    fontSize: 11,
    borderBottom: "1px solid var(--border)",
  },
  selectedFile: {
    background: "rgba(88, 166, 255, 0.15)",
    borderRadius: 4,
  },
};
