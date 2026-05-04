import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ChunkUsed } from "../api/client";

interface Props {
  chunk: ChunkUsed;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: "python", js: "javascript", ts: "typescript",
    jsx: "jsx", tsx: "tsx", json: "json", md: "markdown",
  };
  return map[ext ?? ""] ?? "text";
}

export default function CodeBlock({ chunk }: Props) {
  const lang = detectLanguage(chunk.file_path);
  const label = chunk.function_name
    ? `${chunk.file_path} — ${chunk.function_name}`
    : chunk.file_path;

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <span style={styles.filePath}>{label}</span>
        {chunk.score != null && (
          <span style={styles.score}>score: {chunk.score.toFixed(3)}</span>
        )}
      </div>
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        customStyle={styles.code}
        showLineNumbers={false}
        wrapLongLines
      >
        {chunk.content}
      </SyntaxHighlighter>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 8,
  },
  header: {
    background: "var(--surface-2)",
    padding: "6px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  filePath: {
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--accent)",
    wordBreak: "break-all",
  },
  score: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  code: {
    margin: 0,
    borderRadius: 0,
    fontSize: 12,
    background: "#0d1117",
  },
};
