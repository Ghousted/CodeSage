import { useEffect, useRef, useState } from "react";
import { askQuestion } from "../api/client";
import type { AskResponse, ChatTurn } from "../api/client";
import CodeBlock from "./CodeBlock";
import MarkdownAnswer from "./MarkdownAnswer";

const MAX_HISTORY_TURNS = 6;

interface Message {
  role: "user" | "assistant";
  text: string;
  isError?: boolean;
  response?: AskResponse;
}

interface Props {
  repoUrl: string;
  onOpenFile?: (filePath: string) => void;
}

const SUGGESTIONS = [
  "What is this project for and how do I run it?",
  "Walk me through the entry point of the app.",
  "How is data persisted? Show me the schema or models.",
  "Where are the API routes defined?",
  "What testing framework is used and where are the tests?",
];

export default function ChatInterface({ repoUrl, onOpenFile }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showChunks, setShowChunks] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset chat when the repo changes
  useEffect(() => {
    setMessages([]);
    setShowChunks({});
    abortRef.current?.abort();
  }, [repoUrl]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function buildHistory(prior: Message[]): ChatTurn[] {
    // Skip error bubbles — those are UI-only, not real assistant turns.
    // Then keep only the most recent N messages so the request stays small.
    const usable = prior.filter((m) => !m.isError);
    return usable.slice(-MAX_HISTORY_TURNS).map((m) => ({
      role: m.role,
      content: m.text,
    }));
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const history = buildHistory(messages);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await askQuestion(trimmed, repoUrl, 5, history, abortRef.current.signal);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.answer, response: res },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", text: message, isError: true }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function pickSuggestion(s: string) {
    setInput(s);
    inputRef.current?.focus();
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function clearChat() {
    setMessages([]);
    setShowChunks({});
  }

  function toggleChunks(index: number) {
    setShowChunks((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>
          {messages.length === 0 ? "Ready" : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
        </span>
        {messages.length > 0 && (
          <button type="button" onClick={clearChat} style={styles.clearBtn} disabled={loading}>
            Clear
          </button>
        )}
      </div>

      <div style={styles.messages}>
        {isEmpty && (
          <div style={styles.emptyState} className="fade-in">
            <div style={styles.emptyIconWrap}>
              <span style={styles.emptyIcon}>💬</span>
            </div>
            <h3 style={styles.emptyTitle}>Ask anything about this codebase</h3>
            <p style={styles.emptySubtitle}>
              Answers are grounded in the indexed source. Try one of these to get started:
            </p>
            <div style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  style={styles.suggestion}
                >
                  <span style={styles.suggestionArrow}>→</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="fade-in" style={styles.messageWrap}>
            {msg.role === "user" ? (
              <div style={styles.userBubble}>
                <div style={styles.userText}>{msg.text}</div>
              </div>
            ) : (
              <div style={{ ...styles.asstBubble, ...(msg.isError ? styles.errorBubble : {}) }}>
                <div style={styles.asstHeader}>
                  <span style={msg.isError ? styles.errorPill : styles.asstPill}>
                    {msg.isError ? "Error" : "CodeSage"}
                  </span>
                </div>
                {msg.isError ? (
                  <p style={styles.errorText}>{msg.text}</p>
                ) : (
                  <MarkdownAnswer text={msg.text} />
                )}

                {msg.response && (
                  <div style={styles.sources}>
                    <div style={styles.sourcesRow}>
                      <span style={styles.sourcesLabel}>Sources</span>
                      {msg.response.source_files.slice(0, 6).map((f) => {
                        const basename = f.split("/").pop() || f;
                        return (
                          <button
                            key={f}
                            type="button"
                            style={styles.sourceFile}
                            title={f}
                            onClick={() => onOpenFile?.(f)}
                          >
                            {basename}
                          </button>
                        );
                      })}
                      {msg.response.source_files.length > 6 && (
                        <span style={styles.moreLabel}>
                          +{msg.response.source_files.length - 6}
                        </span>
                      )}
                    </div>
                    <button style={styles.toggleBtn} onClick={() => toggleChunks(i)}>
                      {showChunks[i] ? "▾" : "▸"} {showChunks[i] ? "Hide" : "Show"} retrieved snippets ({msg.response.chunks_used.length})
                    </button>
                    {showChunks[i] && (
                      <div style={styles.chunksList}>
                        {msg.response.chunks_used.map((chunk, j) => (
                          <CodeBlock key={j} chunk={chunk} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={styles.messageWrap}>
            <div style={styles.asstBubble}>
              <div style={styles.asstHeader}>
                <span style={styles.asstPill}>CodeSage</span>
              </div>
              <div style={styles.thinking}>
                <span style={styles.typingDot} />
                <span style={{ ...styles.typingDot, animationDelay: "150ms" }} />
                <span style={{ ...styles.typingDot, animationDelay: "300ms" }} />
                <span style={styles.thinkingText}>Searching code and writing an answer…</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} style={styles.composer}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this codebase…  (Shift+Enter for newline)"
          disabled={loading}
          maxLength={2000}
          rows={1}
          style={styles.textarea}
        />
        {loading ? (
          <button type="button" onClick={cancel} style={{ ...styles.sendBtn, ...styles.cancelSendBtn }}>
            Cancel
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} style={styles.sendBtn}>
            Send
            <span style={styles.sendArrow}>↵</span>
          </button>
        )}
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },

  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottom: "1px solid var(--border-subtle)",
  },
  toolbarLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "4px 12px",
    borderRadius: "var(--r-md)",
  },

  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 0",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  /* empty state */
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 14,
    padding: "32px 16px",
  },
  emptyIconWrap: {
    width: 56, height: 56,
    borderRadius: "50%",
    background:
      "radial-gradient(circle at 30% 30%, rgba(88,166,255,0.18), rgba(163,113,247,0.06))",
    border: "1px solid var(--border)",
    display: "grid",
    placeItems: "center",
  },
  emptyIcon: { fontSize: 24 },
  emptyTitle: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" },
  emptySubtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    maxWidth: 460,
    margin: "0 auto",
    lineHeight: 1.6,
  },
  suggestions: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 8,
    width: "100%",
    maxWidth: 480,
  },
  suggestion: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--text)",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  suggestionArrow: { color: "var(--accent)", fontWeight: 600 },

  /* messages */
  messageWrap: { display: "flex", flexDirection: "column" },

  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    background: "var(--accent)",
    color: "#0b0f15",
    padding: "10px 16px",
    borderRadius: "16px 16px 4px 16px",
  },
  userText: { fontSize: 14, lineHeight: 1.55, fontWeight: 500, whiteSpace: "pre-wrap", wordBreak: "break-word" },

  asstBubble: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "16px 16px 16px 4px",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  errorBubble: {
    border: "1px solid rgba(248, 81, 73, 0.45)",
    background: "rgba(248, 81, 73, 0.06)",
  },
  asstHeader: { display: "flex", alignItems: "center", gap: 8 },
  asstPill: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--accent)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: "rgba(88,166,255,0.1)",
    padding: "2px 8px",
    borderRadius: "var(--r-pill)",
    border: "1px solid rgba(88,166,255,0.3)",
  },
  errorPill: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--error)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: "rgba(248,81,73,0.1)",
    padding: "2px 8px",
    borderRadius: "var(--r-pill)",
    border: "1px solid rgba(248,81,73,0.3)",
  },
  errorText: { color: "var(--text)", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" },

  sources: {
    marginTop: 4,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sourcesRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  sourcesLabel: {
    fontSize: 10,
    color: "var(--text-faint)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginRight: 4,
  },
  sourceFile: {
    fontFamily: "var(--mono)",
    fontSize: 11,
    background: "var(--bg)",
    padding: "2px 8px",
    borderRadius: "var(--r-pill)",
    color: "var(--accent)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  moreLabel: { fontSize: 11, color: "var(--text-muted)" },
  toggleBtn: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    padding: 0,
    fontSize: 12,
    fontWeight: 500,
  },
  chunksList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4 },

  /* thinking */
  thinking: { display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" },
  typingDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "var(--text-muted)",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  thinkingText: { fontSize: 13, color: "var(--text-muted)", marginLeft: 6 },

  /* composer */
  composer: {
    display: "flex",
    gap: 8,
    paddingTop: 12,
    borderTop: "1px solid var(--border-subtle)",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    padding: "12px 14px",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    color: "var(--text)",
    fontSize: 14,
    outline: "none",
    resize: "vertical",
    minHeight: 44,
    maxHeight: 160,
    lineHeight: 1.5,
  },
  sendBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0 18px",
    height: 44,
    background: "var(--accent)",
    color: "#0b0f15",
    border: "none",
    borderRadius: "var(--r-md)",
    fontWeight: 600,
    fontSize: 14,
  },
  cancelSendBtn: {
    background: "var(--surface-3)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  sendArrow: { fontSize: 12, opacity: 0.85 },
};
