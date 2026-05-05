import json
import logging
import os
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from langchain.prompts import PromptTemplate

from core.llm import call_llm, LLMUnavailableError

logger = logging.getLogger(__name__)

_SUMMARY_TEMPLATE = """You are a senior software engineer writing a project brief for a teammate who has never seen this repository.

Your job is to explain WHAT THIS PROJECT DOES and WHY IT EXISTS — not to enumerate libraries.

## Source material

Repository name: {project_name}

README:
{readme}

Entry-point and route source code (excerpts — these are the GROUND TRUTH for what the app actually does):
{code_excerpts}

Dependency files (for the "Built with" line only — do NOT use these to guess the application domain):
{dependencies}

## Output format (use this exact markdown structure)

### What it does
2-3 sentence plain-English description of the product or system. Focus on the user-facing behavior, the problem it solves, and who it is for. Do NOT mention any library, framework, or programming language here.

### Key capabilities
- 4-6 bullets describing concrete features the project offers (what a user can DO with it).
- Each bullet should be an action or outcome, not a technology.
- Ground each bullet in the README or the entry-point/route code above.

### How it works (high level)
2-3 sentences describing the overall approach or architecture in plain language (e.g. "ingests X, transforms it via Y, exposes Z"). Use the entry-point and route code as the primary source for this section.

### Built with
A single short line listing the main technologies (e.g. "Python · FastAPI · React · Pinecone"). One line maximum.

## Rules — read carefully
- The README is authoritative for purpose when it is substantive. When the README is missing, weak, or generic, derive purpose from the entry-point code and route definitions instead — those reveal what the app actually does.
- Do NOT infer the application domain (inventory, e-commerce, social, blog, dashboard, CRM, etc.) from the technology stack alone. FastAPI, React, Pinecone, langchain, sentence-transformers, etc. are general-purpose libraries used by countless unrelated products.
- If the source material does not let you determine the project's purpose, output exactly: "Project purpose could not be determined from the available source material." in the **What it does** section, and skip Key capabilities. Do NOT guess.
- Never invent features, files, function names, or behaviors that are not visible in the source material above.
- Lead with purpose and behavior, never with the stack. Be specific — "a web app" is useless.

## Summary
"""

_SUMMARY_PROMPT = PromptTemplate(
    input_variables=["project_name", "readme", "code_excerpts", "dependencies"],
    template=_SUMMARY_TEMPLATE,
)

# README discovery
README_CANDIDATES = ("README.md", "README.rst", "README.txt", "readme.md", "Readme.md", "readme.rst")
README_SUBDIRS = ("", "docs", "doc")
MAX_README_CHARS = 3000

# A README under this many "useful" chars (after stripping markdown noise) is
# treated as if it were missing — boilerplate / placeholder READMEs lie more
# than they help. Tuned conservatively: 150 chars ≈ 25 substantive words.
TRIVIAL_README_USEFUL_CHARS = 150

# Code excerpt extraction
ENTRY_POINT_FILENAMES = {
    "main.py", "app.py", "index.py", "run.py", "manage.py", "__main__.py",
    "app.js", "index.js", "main.js", "server.js",
    "app.ts", "index.ts", "main.ts", "server.ts",
    "App.tsx", "App.jsx", "main.tsx", "main.jsx",
}
# Substring tokens that hint a path holds API/route/controller code
ROUTE_PATH_HINTS = ("/routes", "/router", "/controllers", "/endpoints", "/handlers", "/api/")
ROUTE_FILENAME_BASES = ("routes", "router", "endpoints", "controllers", "handlers")

MAX_ENTRY_POINTS = 3
MAX_ROUTE_FILES = 2
MAX_EXCERPT_LINES_PER_FILE = 80
MAX_CODE_EXCERPT_CHARS = 3500
MAX_DEPS_CHARS = 1500


def _strip_markdown_noise(text: str) -> str:
    """Approximate the 'useful prose' length of a markdown doc."""
    cleaned = re.sub(r"```.*?```", "", text, flags=re.DOTALL)  # fenced code
    cleaned = re.sub(r"!?\[[^\]]*\]\([^)]*\)", "", cleaned)    # links / images
    cleaned = re.sub(r"<!--.*?-->", "", cleaned, flags=re.DOTALL)  # html comments
    cleaned = re.sub(r"#{1,6}\s*", "", cleaned)                # headers
    cleaned = re.sub(r"[*_`>~|=-]+", " ", cleaned)             # markdown punctuation
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _is_trivial_readme(text: str) -> bool:
    if not text:
        return True
    return len(_strip_markdown_noise(text)) < TRIVIAL_README_USEFUL_CHARS


def _read_readme(repo_path: str) -> str:
    root = Path(repo_path)
    for subdir in README_SUBDIRS:
        base = root / subdir if subdir else root
        if not base.is_dir():
            continue
        for name in README_CANDIDATES:
            candidate = base / name
            if candidate.is_file():
                try:
                    return candidate.read_text(encoding="utf-8", errors="ignore")[:MAX_README_CHARS]
                except OSError as exc:
                    logger.warning("Could not read %s: %s", candidate, exc)
    return ""


def _read_dependencies(repo_path: str) -> str:
    parts = []
    root = Path(repo_path)

    req = root / "requirements.txt"
    if req.exists():
        try:
            parts.append("requirements.txt:\n" + req.read_text(encoding="utf-8", errors="ignore")[:1000])
        except OSError:
            pass

    pyproject = root / "pyproject.toml"
    if pyproject.exists():
        try:
            parts.append("pyproject.toml (excerpt):\n" + pyproject.read_text(encoding="utf-8", errors="ignore")[:1000])
        except OSError:
            pass

    pkg = root / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            dep_str = "\n".join(f"  {k}: {v}" for k, v in list(deps.items())[:30])
            parts.append(f"package.json dependencies:\n{dep_str}")
        except (json.JSONDecodeError, OSError) as exc:
            logger.debug("Could not parse package.json: %s", exc)

    return ("\n\n".join(parts))[:MAX_DEPS_CHARS]


def _looks_like_route_file(rel_path: str, filename: str) -> bool:
    rel_lower = "/" + rel_path.lower()
    if any(token in rel_lower for token in ROUTE_PATH_HINTS):
        return True
    stem = Path(filename).stem.lower()
    return stem in ROUTE_FILENAME_BASES


def _select_code_files(repo_path: str, file_paths: List[str]) -> tuple[List[Path], List[Path]]:
    """Pick a few entry-point files and a few route-looking files from the scan."""
    root = Path(repo_path)
    entry_files: List[Path] = []
    route_files: List[Path] = []

    for fp in file_paths:
        p = Path(fp)
        try:
            rel = str(p.relative_to(root)).replace(os.sep, "/")
        except ValueError:
            continue
        name = p.name

        if name in ENTRY_POINT_FILENAMES:
            if len(entry_files) < MAX_ENTRY_POINTS:
                entry_files.append(p)
        elif _looks_like_route_file(rel, name):
            if len(route_files) < MAX_ROUTE_FILES:
                route_files.append(p)

        if len(entry_files) >= MAX_ENTRY_POINTS and len(route_files) >= MAX_ROUTE_FILES:
            break

    return entry_files, route_files


def _build_code_excerpts(repo_path: str, file_paths: Optional[List[str]]) -> str:
    """Extract a small, prompt-friendly slice of the most-telling source files."""
    if not file_paths:
        return "(no source files were scanned)"

    root = Path(repo_path)
    entry_files, route_files = _select_code_files(repo_path, file_paths)

    if not entry_files and not route_files:
        return "(no entry-point or route files identified)"

    parts: List[str] = []
    used = 0

    def add(label: str, p: Path) -> None:
        nonlocal used
        if used >= MAX_CODE_EXCERPT_CHARS:
            return
        try:
            content = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return
        lines = content.splitlines()[:MAX_EXCERPT_LINES_PER_FILE]
        excerpt = "\n".join(lines)
        budget = MAX_CODE_EXCERPT_CHARS - used
        if len(excerpt) > budget:
            excerpt = excerpt[:budget] + "\n# ...(truncated)"
        try:
            rel = str(p.relative_to(root)).replace(os.sep, "/")
        except ValueError:
            rel = p.name
        parts.append(f"### {label}: {rel}\n```\n{excerpt}\n```")
        used += len(excerpt)

    for p in entry_files:
        add("Entry point", p)
    for p in route_files:
        add("Route file", p)

    return "\n\n".join(parts) if parts else "(no readable code files)"


def _project_name(repo_path: str) -> str:
    name = Path(repo_path).name
    return name or "(unknown)"


def generate_summary(repo_path: str, file_paths: Optional[List[str]] = None) -> Dict[str, Any]:
    """Generate a structured project summary using README, entry-point code, and dependencies.

    The README is authoritative when present and substantive. When the README is missing
    or trivially short, the LLM falls back to the entry-point and route source excerpts —
    that keeps the summary grounded in real code instead of guessing from library names.

    Falls back to a deterministic placeholder if the LLM is unavailable so that
    /analyze still succeeds and the user can use /ask.
    """
    raw_readme = _read_readme(repo_path)
    project_name = _project_name(repo_path)

    if _is_trivial_readme(raw_readme):
        readme_block = (
            "(No substantive README found — derive purpose from the entry-point and route code below.)"
        )
        if raw_readme:
            logger.info("README present but treated as trivial (%d chars)", len(raw_readme))
    else:
        readme_block = raw_readme

    code_excerpts = _build_code_excerpts(repo_path, file_paths)
    dependencies = _read_dependencies(repo_path) or "(no dependency files found)"

    prompt = _SUMMARY_PROMPT.format(
        project_name=project_name,
        readme=readme_block,
        code_excerpts=code_excerpts,
        dependencies=dependencies,
    )

    try:
        summary_text = call_llm(prompt, max_tokens=512)
    except LLMUnavailableError as exc:
        logger.warning("Falling back to placeholder summary: %s", exc)
        summary_text = (
            "(Automatic summary unavailable — LLM not reachable.)\n\n"
            f"Project: {project_name}\n\n"
            f"README excerpt:\n{raw_readme[:500] if raw_readme else '(none)'}"
        )

    return {
        "summary": summary_text.strip(),
        "readme_excerpt": raw_readme[:500],
        "dependency_info": dependencies[:500],
    }
