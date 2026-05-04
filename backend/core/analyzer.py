import logging
import os
from collections import Counter
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

ENTRY_POINT_NAMES = {
    "main.py", "app.py", "index.py", "run.py", "manage.py", "__main__.py",
    "app.js", "index.js", "main.js", "server.js",
    "app.ts", "index.ts", "main.ts", "server.ts",
}
CONFIG_NAMES = {
    "config.py", "settings.py", "config.js", "config.ts",
    ".env", ".env.example", "vite.config.ts", "vite.config.js",
    "webpack.config.js", "tsconfig.json", "pyproject.toml", "setup.cfg",
    "next.config.js", "rollup.config.js", "babel.config.js",
}
ROUTE_PATTERNS = ("routes", "router", "controllers", "views", "handlers", "endpoints", "/api/")
MODEL_PATTERNS = ("models", "schemas", "entities", "/db/", "/database/", "orm")

EXT_LANG = {
    ".py": "Python", ".js": "JavaScript", ".ts": "TypeScript",
    ".jsx": "React JSX", ".tsx": "React TSX", ".json": "JSON", ".md": "Markdown",
}


def analyze_structure(repo_path: str, file_paths: List[str]) -> Dict[str, Any]:
    """Identify important files and rank them by role and size."""
    root = Path(repo_path)
    import_counter: Counter[str] = Counter()

    for fp in file_paths:
        try:
            content = Path(fp).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith(("import ", "from ")):
                import_counter[fp] += 1

    categorized: Dict[str, List[Dict[str, Any]]] = {
        "entry_points": [],
        "config_files": [],
        "api_routes": [],
        "db_models": [],
        "other_key_files": [],
    }

    for fp in file_paths:
        try:
            size = os.path.getsize(fp)
        except OSError:
            continue
        try:
            relative = str(Path(fp).relative_to(root)).replace(os.sep, "/")
        except ValueError:
            continue
        name = Path(fp).name.lower()

        record = {
            "path": relative,
            "size_bytes": size,
            "import_count": import_counter.get(fp, 0),
        }

        rel_lower = relative.lower()
        if name in ENTRY_POINT_NAMES:
            categorized["entry_points"].append(record)
        elif name in CONFIG_NAMES:
            categorized["config_files"].append(record)
        elif any(p in rel_lower for p in ROUTE_PATTERNS):
            categorized["api_routes"].append(record)
        elif any(p in rel_lower for p in MODEL_PATTERNS):
            categorized["db_models"].append(record)

    categorized_paths = {item["path"] for group in categorized.values() for item in group}

    remaining = []
    for fp in file_paths:
        try:
            relative = str(Path(fp).relative_to(root)).replace(os.sep, "/")
            size = os.path.getsize(fp)
        except (OSError, ValueError):
            continue
        if relative in categorized_paths:
            continue
        remaining.append({
            "path": relative,
            "size_bytes": size,
            "import_count": import_counter.get(fp, 0),
        })

    # Rank by import frequency, then size — surfaces "most depended-on" files.
    remaining.sort(key=lambda x: (x["import_count"], x["size_bytes"]), reverse=True)
    categorized["other_key_files"] = remaining[:10]

    return {
        "total_files": len(file_paths),
        "structure": categorized,
        "language_breakdown": _language_breakdown(file_paths),
    }


def _language_breakdown(file_paths: List[str]) -> Dict[str, int]:
    counter: Counter[str] = Counter()
    for fp in file_paths:
        lang = EXT_LANG.get(Path(fp).suffix.lower(), "Other")
        counter[lang] += 1
    return dict(counter.most_common())
