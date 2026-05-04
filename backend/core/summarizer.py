import json
import logging
from pathlib import Path
from typing import Dict, Any
from langchain.prompts import PromptTemplate

from core.llm import call_llm, LLMUnavailableError

logger = logging.getLogger(__name__)

_SUMMARY_TEMPLATE = """You are a senior software engineer writing a project brief for a teammate who has never seen this repository.

Your job is to explain WHAT THIS PROJECT DOES and WHY IT EXISTS — not to enumerate libraries.

## Source material

README:
{readme}

Dependency files (for reference only — do NOT make these the focus):
{dependencies}

## Output format (use this exact markdown structure)

### What it does
2-3 sentence plain-English description of the product or system. Focus on the user-facing behavior, the problem it solves, and who it is for. Do NOT mention any library, framework, or programming language here.

### Key capabilities
- 4-6 bullets describing concrete features the project offers (what a user can DO with it).
- Each bullet should be an action or outcome, not a technology.

### How it works (high level)
2-3 sentences describing the overall approach or architecture in plain language (e.g. "ingests X, transforms it via Y, exposes Z"). Still avoid library names unless they ARE the product.

### Built with
A single short line listing the main technologies (e.g. "Python · FastAPI · React · Pinecone"). One line maximum. This section comes last on purpose — the stack is the least interesting thing about the project.

## Rules
- Lead with purpose and behavior, never with the stack.
- Be specific. "A web app" is useless; "A dashboard for tracking warehouse inventory in real time" is useful.
- If the README does not state the purpose clearly, infer it from the dependencies and entry points, but say "appears to" so the reader knows it is inferred.
- Do not invent features that are not evidenced in the source material.

## Summary
"""

_SUMMARY_PROMPT = PromptTemplate(
    input_variables=["readme", "dependencies"],
    template=_SUMMARY_TEMPLATE,
)

README_CANDIDATES = ("README.md", "README.rst", "README.txt", "readme.md", "Readme.md")
MAX_README_CHARS = 3000
MAX_DEPS_CHARS = 1500


def _read_readme(repo_path: str) -> str:
    root = Path(repo_path)
    for name in README_CANDIDATES:
        candidate = root / name
        if candidate.exists():
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


def generate_summary(repo_path: str) -> Dict[str, Any]:
    """Generate a structured project summary using the README and dependency files.

    Falls back to a deterministic placeholder if the LLM is unavailable so that
    /analyze still succeeds and the user can use /ask.
    """
    readme = _read_readme(repo_path) or "No README found."
    dependencies = _read_dependencies(repo_path) or "No dependency files found."

    prompt = _SUMMARY_PROMPT.format(readme=readme, dependencies=dependencies)

    try:
        summary_text = call_llm(prompt, max_tokens=512)
    except LLMUnavailableError as exc:
        logger.warning("Falling back to placeholder summary: %s", exc)
        summary_text = (
            "(Automatic summary unavailable — LLM not reachable.)\n\n"
            f"README excerpt:\n{readme[:500]}"
        )

    return {
        "summary": summary_text.strip(),
        "readme_excerpt": readme[:500],
        "dependency_info": dependencies[:500],
    }
