import { Link } from "react-router-dom";

interface Props {
  /** Optional context strip shown to the right of the logo (e.g. active repo) */
  contextSlot?: React.ReactNode;
  /** Optional right-side actions */
  actionsSlot?: React.ReactNode;
}

export default function Header({ contextSlot, actionsSlot }: Props) {
  return (
    <header style={styles.header}>
      <div style={styles.inner}>
        <Link to="/" style={styles.logoLink} aria-label="CodeSage home">
          <LogoMark />
          <span style={styles.logoText}>CodeSage</span>
        </Link>
        {contextSlot && <div style={styles.context}>{contextSlot}</div>}
        <div style={styles.actions}>{actionsSlot}</div>
      </div>
    </header>
  );
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="hdr-lg" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#58a6ff" />
          <stop offset="1" stopColor="#a371f7" />
        </linearGradient>
      </defs>
      <path d="M4 6 L12 3 L20 6 L20 18 L12 21 L4 18 Z" stroke="url(#hdr-lg)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 10 L12 8 L15 10 L15 14 L12 16 L9 14 Z" fill="url(#hdr-lg)" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    position: "sticky",
    top: 0,
    background: "rgba(11, 15, 21, 0.85)",
    backdropFilter: "saturate(160%) blur(8px)",
    WebkitBackdropFilter: "saturate(160%) blur(8px)",
    borderBottom: "1px solid var(--border-subtle)",
    zIndex: 50,
  },
  inner: {
    maxWidth: 1140,
    margin: "0 auto",
    padding: "12px 24px",
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  logoLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--text)",
    flexShrink: 0,
  },
  logoText: { fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" },
  context: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text-muted)",
    fontSize: 13,
  },
  actions: { display: "flex", alignItems: "center", gap: 8 },
};
