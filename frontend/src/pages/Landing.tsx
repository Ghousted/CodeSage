import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div style={styles.page} className="glow-bg">
      <header style={styles.nav}>
        <div style={styles.logoWrap}>
          <LogoMark />
          <span style={styles.logoText}>CodeSage</span>
        </div>
        <Link to="/app" style={styles.navCta}>
          Open app →
        </Link>
      </header>

      <main style={styles.main}>
        {/* Hero */}
        <section style={styles.hero} className="fade-in">
          <span style={styles.eyebrow}>AI codebase analyzer</span>
          <h1 style={styles.h1}>
            Understand any GitHub repo in <span className="gradient-text">minutes</span>.
          </h1>
          <p style={styles.subhead}>
            Paste a public GitHub URL. CodeSage indexes the codebase, then answers your
            questions with real, cited code — so you can onboard, audit, or learn fast.
          </p>
          <div style={styles.ctaRow}>
            <Link to="/app" style={styles.primaryCta}>
              Try CodeSage
              <span style={styles.ctaArrow}>→</span>
            </Link>
            <a href="#how" style={styles.secondaryCta}>How it works</a>
          </div>
          <p style={styles.fineprint}>Free · No signup · Public repos only</p>
        </section>

        {/* Mock terminal preview */}
        <section style={styles.previewWrap} className="fade-in">
          <div style={styles.preview}>
            <div style={styles.previewHeader}>
              <span style={{ ...styles.dot, background: "#ff5f57" }} />
              <span style={{ ...styles.dot, background: "#febc2e" }} />
              <span style={{ ...styles.dot, background: "#28c840" }} />
              <span style={styles.previewTitle}>codesage.app · facebook/react</span>
            </div>
            <div style={styles.previewBody}>
              <div style={styles.userBubble}>
                How does the reconciler decide when to bail out of a re-render?
              </div>
              <div style={styles.assistantBubble}>
                <div style={styles.assistantHeader}>
                  <span style={styles.greenDot} />
                  Grounded in <strong>3 files</strong>
                </div>
                <p style={styles.assistantText}>
                  In <code style={styles.codeInline}>ReactFiberBeginWork.js</code>, the
                  reconciler calls <code style={styles.codeInline}>bailoutOnAlreadyFinishedWork</code>{" "}
                  when the current props and state shallow-compare equal to the previous fiber…
                </p>
                <div style={styles.sourcePills}>
                  <span style={styles.sourcePill}>ReactFiberBeginWork.js</span>
                  <span style={styles.sourcePill}>ReactFiberHooks.js</span>
                  <span style={styles.sourcePill}>ReactFiberReconciler.js</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section style={styles.features}>
          <FeatureCard
            icon="💬"
            title="Ask in plain English"
            body="No need to grep through thousands of files. Ask questions the way you'd ask a teammate."
          />
          <FeatureCard
            icon="🌳"
            title="Browse like GitHub"
            body="Switch branches, expand the file tree, and view any file inline with syntax highlighting."
          />
          <FeatureCard
            icon="🔍"
            title="Always grounded"
            body="Every answer cites the exact files and snippets it came from. No invented APIs, no guesses."
          />
        </section>

        {/* How it works */}
        <section style={styles.howSection} id="how">
          <div style={styles.howHeader}>
            <span style={styles.eyebrow}>How it works</span>
            <h2 style={styles.h2}>Three steps. About a minute.</h2>
          </div>
          <ol style={styles.steps}>
            <Step
              n={1}
              title="Paste a public GitHub URL"
              body="Anything from a 50-line gist to a multi-thousand-file framework."
            />
            <Step
              n={2}
              title="We index it in the background"
              body="The repo is cloned, parsed at the function and class level, embedded, and stored. You'll see live progress."
            />
            <Step
              n={3}
              title="Ask, browse, learn"
              body="Use the chat for conceptual questions. Use the file tree to read the code. Switch branches anytime."
            />
          </ol>
        </section>

        {/* Final CTA */}
        <section style={styles.finalCta} className="fade-in">
          <h3 style={styles.finalH}>Ready to dig in?</h3>
          <p style={styles.finalSub}>Pick any public repo and see what your team has been shipping.</p>
          <Link to="/app" style={styles.primaryCta}>
            Try CodeSage
            <span style={styles.ctaArrow}>→</span>
          </Link>
        </section>
      </main>

      <footer style={styles.footer}>
        <span>Built with FastAPI · HuggingFace · Pinecone · React</span>
        <a href="https://github.com" target="_blank" rel="noreferrer" style={styles.footerLink}>
          GitHub
        </a>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <article style={styles.featureCard}>
      <div style={styles.featureIcon}>{icon}</div>
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.featureBody}>{body}</p>
    </article>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li style={styles.step}>
      <div style={styles.stepNumber}>{n}</div>
      <div style={styles.stepBody}>
        <h4 style={styles.stepTitle}>{title}</h4>
        <p style={styles.stepText}>{body}</p>
      </div>
    </li>
  );
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#58a6ff" />
          <stop offset="1" stopColor="#a371f7" />
        </linearGradient>
      </defs>
      <path
        d="M4 6 L12 3 L20 6 L20 18 L12 21 L4 18 Z"
        stroke="url(#lg)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 10 L12 8 L15 10 L15 14 L12 16 L9 14 Z" fill="url(#lg)" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },

  /* nav */
  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 32px",
    maxWidth: 1140,
    margin: "0 auto",
    width: "100%",
  },
  logoWrap: { display: "flex", alignItems: "center", gap: 10 },
  logoText: { fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" },
  navCta: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "6px 14px",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
  },

  /* main */
  main: {
    maxWidth: 1140,
    margin: "0 auto",
    padding: "0 32px",
    width: "100%",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 96,
  },

  /* hero */
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    paddingTop: 64,
    gap: 20,
    maxWidth: 760,
    margin: "0 auto",
  },
  eyebrow: {
    fontSize: 12,
    color: "var(--accent)",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 600,
  },
  h1: {
    fontSize: "clamp(36px, 6vw, 60px)",
    fontWeight: 700,
    letterSpacing: "-0.025em",
    lineHeight: 1.05,
  },
  subhead: {
    fontSize: 17,
    color: "var(--text-muted)",
    lineHeight: 1.6,
    maxWidth: 580,
  },
  ctaRow: { display: "flex", gap: 12, marginTop: 8 },
  primaryCta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 24px",
    background: "var(--accent)",
    color: "#0b0f15",
    fontWeight: 600,
    fontSize: 15,
    borderRadius: "var(--r-md)",
    boxShadow: "var(--sh-glow)",
  },
  ctaArrow: { transition: "transform var(--t-fast)" },
  secondaryCta: {
    display: "inline-flex",
    alignItems: "center",
    padding: "14px 18px",
    color: "var(--text)",
    fontSize: 15,
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
  },
  fineprint: { fontSize: 12, color: "var(--text-faint)" },

  /* preview */
  previewWrap: { display: "flex", justifyContent: "center" },
  preview: {
    width: "100%",
    maxWidth: 720,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    overflow: "hidden",
    boxShadow: "var(--sh-md)",
  },
  previewHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 14px",
    background: "var(--surface-2)",
    borderBottom: "1px solid var(--border)",
  },
  dot: { width: 11, height: 11, borderRadius: "50%" },
  previewTitle: {
    marginLeft: 12,
    fontSize: 12,
    color: "var(--text-muted)",
    fontFamily: "var(--mono)",
  },
  previewBody: { padding: 20, display: "flex", flexDirection: "column", gap: 14 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "78%",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    padding: "10px 14px",
    borderRadius: "12px 12px 4px 12px",
    fontSize: 13,
  },
  assistantBubble: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    padding: "12px 14px",
    borderRadius: "12px 12px 12px 4px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  assistantHeader: {
    fontSize: 11,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  greenDot: { width: 6, height: 6, borderRadius: "50%", background: "var(--success)" },
  assistantText: { fontSize: 13, lineHeight: 1.6 },
  codeInline: {
    fontFamily: "var(--mono)",
    fontSize: 11.5,
    background: "var(--bg)",
    padding: "1px 6px",
    borderRadius: 4,
    color: "var(--accent)",
    border: "1px solid var(--border)",
  },
  sourcePills: { display: "flex", flexWrap: "wrap", gap: 4 },
  sourcePill: {
    fontFamily: "var(--mono)",
    fontSize: 10,
    background: "var(--bg)",
    color: "var(--accent)",
    padding: "2px 8px",
    borderRadius: "var(--r-pill)",
    border: "1px solid var(--border)",
  },

  /* features */
  features: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
  },
  featureCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    transition: "border-color var(--t-med), transform var(--t-med)",
  },
  featureIcon: { fontSize: 28 },
  featureTitle: { fontSize: 16, fontWeight: 600 },
  featureBody: { fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 },

  /* how it works */
  howSection: { display: "flex", flexDirection: "column", gap: 28 },
  howHeader: { display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center" },
  h2: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" },
  steps: {
    listStyle: "none",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 16,
  },
  step: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-lg)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
    color: "#0b0f15",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 14,
  },
  stepBody: { display: "flex", flexDirection: "column", gap: 4 },
  stepTitle: { fontSize: 15, fontWeight: 600 },
  stepText: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 },

  /* final cta */
  finalCta: {
    background:
      "radial-gradient(80% 80% at 50% 50%, rgba(88,166,255,0.12), transparent 70%), var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-xl)",
    padding: "56px 32px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
  },
  finalH: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" },
  finalSub: { color: "var(--text-muted)", fontSize: 15, marginBottom: 6 },

  /* footer */
  footer: {
    maxWidth: 1140,
    margin: "0 auto",
    padding: "32px",
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid var(--border-subtle)",
    color: "var(--text-faint)",
    fontSize: 12,
    marginTop: 64,
  },
  footerLink: { fontSize: 12, color: "var(--text-muted)" },
};
