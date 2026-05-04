import { useEffect, useRef, useState } from "react";
import RepoInput from "../components/RepoInput";
import ChatInterface from "../components/ChatInterface";
import MarkdownAnswer from "../components/MarkdownAnswer";
import StructurePanel from "../components/StructurePanel";
import Header from "../components/Header";
import type { AnalyzeResult } from "../api/client";

type Tab = "summary" | "structure";

interface RepoState {
  url: string;
  result: AnalyzeResult;
}

export default function Workspace() {
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  function handleAnalyzed(url: string, result: AnalyzeResult) {
    setRepo({ url, result });
    setActiveTab("summary");
    setChatOpen(true);
  }

  function reset() {
    setRepo(null);
    setActiveTab("summary");
    setSelectedFile(null);
    setChatOpen(false);
  }

  function handleOpenFile(filePath: string) {
    setSelectedFile(filePath);
    setActiveTab("structure");
  }

  return (
    <div style={styles.layout}>
      <Header
        contextSlot={
          repo ? (
            <div style={styles.repoContext}>
              <span style={styles.repoChip}>
                <span style={styles.repoIcon}>●</span>
                {repoSlug(repo.url)}
              </span>
              <span style={styles.repoMeta}>
                {repo.result.files_indexed} files · {repo.result.chunks_stored} chunks
                {repo.result.indexed_branch && (
                  <> · branch <code style={styles.branchCode}>{repo.result.indexed_branch}</code></>
                )}
              </span>
            </div>
          ) : null
        }
        actionsSlot={
          repo ? (
            <button type="button" onClick={reset} style={styles.changeBtn}>
              Change repo
            </button>
          ) : null
        }
      />

      <main style={styles.main}>
        {!repo ? <EmptyState onAnalyzed={handleAnalyzed} /> : (
          <div style={styles.workspace}>
            <nav style={styles.tabs} role="tablist">
              {(["summary", "structure"] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
                >
                  {labelFor(tab)}
                </button>
              ))}
            </nav>

            <section style={styles.tabPanel} className="fade-in" key={activeTab}>
              {activeTab === "summary" && (
                <div style={styles.summaryWrap}>
                  <MarkdownAnswer text={repo.result.summary} />
                </div>
              )}
              {activeTab === "structure" && (
                <StructurePanel result={repo.result} repoUrl={repo.url} selectedFile={selectedFile} />
              )}
            </section>
          </div>
        )}
      </main>

      {repo && (
        <FloatingChat
          open={chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
          onClose={() => setChatOpen(false)}
        >
          <ChatInterface repoUrl={repo.url} onOpenFile={handleOpenFile} />
        </FloatingChat>
      )}
    </div>
  );
}

const DEFAULT_CHAT_WIDTH = 420;
const DEFAULT_CHAT_HEIGHT = 640;
const CHAT_MARGIN = 24;

function FloatingChat({
  open,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Initialize panel anchored to bottom-right after first paint, when we know the size.
  useEffect(() => {
    if (pos !== null) return;
    const w = panelRef.current?.offsetWidth ?? DEFAULT_CHAT_WIDTH;
    const h = panelRef.current?.offsetHeight ?? DEFAULT_CHAT_HEIGHT;
    setPos({
      left: Math.max(CHAT_MARGIN, window.innerWidth - w - CHAT_MARGIN),
      top: Math.max(CHAT_MARGIN, window.innerHeight - h - CHAT_MARGIN),
    });
  }, [pos]);

  // Keep the panel on-screen when the viewport shrinks.
  useEffect(() => {
    function clamp() {
      const el = panelRef.current;
      if (!el) return;
      setPos((p) => {
        if (!p) return p;
        const maxLeft = window.innerWidth - el.offsetWidth;
        const maxTop = window.innerHeight - el.offsetHeight;
        return {
          left: Math.max(0, Math.min(maxLeft, p.left)),
          top: Math.max(0, Math.min(maxTop, p.top)),
        };
      });
    }
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);

  function startDrag(e: React.MouseEvent) {
    // Don't start a drag if the user clicked the close button
    if ((e.target as HTMLElement).closest("button")) return;
    if (!pos) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startTop: pos.top,
    };
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }

  function onDragMove(e: MouseEvent) {
    const d = dragRef.current;
    const el = panelRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxLeft = window.innerWidth - el.offsetWidth;
    const maxTop = window.innerHeight - el.offsetHeight;
    setPos({
      left: Math.max(0, Math.min(maxLeft, d.startLeft + dx)),
      top: Math.max(0, Math.min(maxTop, d.startTop + dy)),
    });
  }

  function onDragEnd() {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
  }

  const positionStyle: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : { right: CHAT_MARGIN, bottom: CHAT_MARGIN };

  return (
    <>
      <div
        ref={panelRef}
        style={{
          ...styles.chatPanel,
          ...positionStyle,
          ...(open ? styles.chatPanelOpen : styles.chatPanelClosed),
        }}
        aria-hidden={!open}
      >
        <div style={styles.chatPanelHeader} onMouseDown={startDrag}>
          <span style={styles.chatPanelTitle}>
            <span style={styles.chatPanelDot} />
            Ask CodeSage
          </span>
          <span style={styles.chatPanelDragHint}>drag to move</span>
          <button type="button" onClick={onClose} style={styles.chatPanelClose} aria-label="Minimize chat">
            ×
          </button>
        </div>
        <div style={styles.chatPanelBody}>{children}</div>
      </div>

      {!open && (
        <button type="button" onClick={onToggle} style={styles.chatBubble} aria-label="Open chat">
          <span style={styles.chatBubbleIcon}>💬</span>
          <span style={styles.chatBubbleText}>Ask</span>
        </button>
      )}
    </>
  );
}

function EmptyState({ onAnalyzed }: { onAnalyzed: (url: string, r: AnalyzeResult) => void }) {
  return (
    <div style={styles.empty} className="fade-in">
      <div style={styles.emptyHeader}>
        <h1 style={styles.emptyH1}>What repo would you like to explore?</h1>
        <p style={styles.emptySub}>
          Paste any public GitHub URL. CodeSage will analyze it, then you can ask questions
          and browse files.
        </p>
      </div>
      <div style={styles.inputCard}>
        <RepoInput onAnalyzed={onAnalyzed} />
      </div>
      <div style={styles.examples}>
        <span style={styles.examplesLabel}>Try one of these:</span>
        {EXAMPLES.map((ex) => (
          <ExampleChip key={ex.url} url={ex.url} label={ex.label} />
        ))}
      </div>
    </div>
  );
}

function ExampleChip({ url, label }: { url: string; label: string }) {
  function copyToInput() {
    const input = document.querySelector<HTMLInputElement>('input[type="url"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )?.set;
      setter?.call(input, url);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }
  }
  return (
    <button type="button" onClick={copyToInput} style={styles.exampleChip} title={url}>
      {label}
    </button>
  );
}

const EXAMPLES = [
  { label: "fastapi/fastapi", url: "https://github.com/fastapi/fastapi" },
  { label: "langchain-ai/langchain", url: "https://github.com/langchain-ai/langchain" },
  { label: "vercel/next.js", url: "https://github.com/vercel/next.js" },
];

function labelFor(tab: Tab): string {
  return { summary: "Summary", structure: "Structure" }[tab];
}

function repoSlug(url: string): string {
  return url.replace("https://github.com/", "").replace(/\/$/, "");
}

const styles: Record<string, React.CSSProperties> = {
  layout: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },

  /* repo context shown in header */
  repoContext: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
    overflow: "hidden",
  },
  repoChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    padding: "4px 10px",
    borderRadius: "var(--r-pill)",
    fontFamily: "var(--mono)",
    fontSize: 12,
    color: "var(--text)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  repoIcon: { color: "var(--success)", fontSize: 9 },
  repoMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  branchCode: {
    fontFamily: "var(--mono)",
    color: "var(--accent)",
    fontSize: 11,
    background: "var(--surface-2)",
    padding: "1px 6px",
    borderRadius: 4,
  },
  changeBtn: {
    fontSize: 12,
    color: "var(--text-muted)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "5px 12px",
  },

  /* main area */
  main: {
    flex: 1,
    width: "100%",
    maxWidth: 1140,
    margin: "0 auto",
    padding: "32px 24px 48px",
  },

  /* empty / first-load state */
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 48,
    gap: 24,
    maxWidth: 720,
    margin: "0 auto",
  },
  emptyHeader: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyH1: {
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  emptySub: {
    fontSize: 15,
    color: "var(--text-muted)",
    maxWidth: 520,
    margin: "0 auto",
    lineHeight: 1.6,
  },
  inputCard: {
    width: "100%",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: 20,
    boxShadow: "var(--sh-md)",
  },
  examples: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  examplesLabel: {
    fontSize: 12,
    color: "var(--text-faint)",
    marginRight: 4,
  },
  exampleChip: {
    fontFamily: "var(--mono)",
    fontSize: 11,
    background: "var(--surface)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-pill)",
    padding: "5px 12px",
  },

  /* loaded workspace */
  workspace: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  tabs: {
    display: "flex",
    gap: 2,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: 4,
    width: "fit-content",
  },
  tab: {
    padding: "8px 16px",
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: "var(--r-sm)",
  },
  tabActive: {
    background: "var(--surface-3)",
    color: "var(--text)",
  },
  tabPanel: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: 20,
    minHeight: 480,
    display: "flex",
    flexDirection: "column",
  },
  summaryWrap: { padding: "4px 4px 8px" },

  /* floating chat */
  chatPanel: {
    position: "fixed",
    width: 420,
    height: 640,
    minWidth: 320,
    minHeight: 360,
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "calc(100vh - 16px)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    boxShadow: "0 20px 50px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    resize: "both",
    zIndex: 50,
    transition: "opacity 200ms ease, transform 200ms ease",
  },
  chatPanelOpen: {
    opacity: 1,
    transform: "scale(1)",
    pointerEvents: "auto",
  },
  chatPanelClosed: {
    opacity: 0,
    transform: "scale(0.92)",
    pointerEvents: "none",
  },
  chatPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "var(--surface-2)",
    cursor: "move",
    userSelect: "none",
  },
  chatPanelDragHint: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginLeft: "auto",
    marginRight: 4,
    pointerEvents: "none",
  },
  chatPanelTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text)",
  },
  chatPanelDot: {
    width: 8, height: 8,
    borderRadius: "50%",
    background: "var(--accent)",
    boxShadow: "0 0 0 3px rgba(88,166,255,0.18)",
  },
  chatPanelClose: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 6px",
    borderRadius: 4,
  },
  chatPanelBody: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    padding: "12px 16px 16px",
  },

  chatBubble: {
    position: "fixed",
    right: 24,
    bottom: 24,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 18px",
    background: "var(--accent)",
    color: "#0b0f15",
    border: "none",
    borderRadius: "var(--r-pill)",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(88,166,255,0.35), 0 2px 6px rgba(0,0,0,0.25)",
    zIndex: 50,
  },
  chatBubbleIcon: { fontSize: 16 },
  chatBubbleText: { letterSpacing: "0.01em" },
};
