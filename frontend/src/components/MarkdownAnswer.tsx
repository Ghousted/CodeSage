import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  text: string;
}

export default function MarkdownAnswer({ text }: Props) {
  return (
    <div style={styles.container}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => <h3 style={styles.h1} {...props} />,
          h2: (props) => <h3 style={styles.h2} {...props} />,
          h3: (props) => <h4 style={styles.h3} {...props} />,
          p: (props) => <p style={styles.p} {...props} />,
          ul: (props) => <ul style={styles.ul} {...props} />,
          ol: (props) => <ol style={styles.ol} {...props} />,
          li: (props) => <li style={styles.li} {...props} />,
          a: (props) => <a style={styles.a} target="_blank" rel="noreferrer" {...props} />,
          strong: (props) => <strong style={styles.strong} {...props} />,
          code: ({ inline, className, children, ...rest }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            if (inline || !match) {
              return <code style={styles.inlineCode} {...rest}>{children}</code>;
            }
            return (
              <SyntaxHighlighter
                language={match[1]}
                style={vscDarkPlus}
                customStyle={styles.codeBlock}
                wrapLongLines
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          },
          blockquote: (props) => <blockquote style={styles.blockquote} {...props} />,
          hr: () => <hr style={styles.hr} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { lineHeight: 1.65, color: "var(--text)" },
  h1: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--accent)",
    margin: "16px 0 6px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  h2: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--accent)",
    margin: "14px 0 6px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  h3: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    margin: "12px 0 4px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  p: { margin: "6px 0", fontSize: 14 },
  ul: { margin: "6px 0 6px 20px", padding: 0 },
  ol: { margin: "6px 0 6px 20px", padding: 0 },
  li: { margin: "3px 0", fontSize: 14 },
  a: { color: "var(--accent)", textDecoration: "underline" },
  strong: { color: "var(--text)", fontWeight: 600 },
  inlineCode: {
    fontFamily: "var(--mono)",
    fontSize: 12,
    background: "var(--surface-2)",
    padding: "1px 6px",
    borderRadius: 4,
    color: "var(--accent)",
    border: "1px solid var(--border)",
  },
  codeBlock: {
    margin: "8px 0",
    borderRadius: 6,
    fontSize: 12,
    border: "1px solid var(--border)",
  },
  blockquote: {
    borderLeft: "3px solid var(--border)",
    margin: "8px 0",
    padding: "4px 12px",
    color: "var(--text-muted)",
  },
  hr: {
    border: "none",
    borderTop: "1px solid var(--border)",
    margin: "12px 0",
  },
};
