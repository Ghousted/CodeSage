import ast
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

MAX_CHUNK_CHARS = 4000  # ~1000 tokens
MAX_PREAMBLE_CHARS = 800
MIN_CHUNK_CHARS = 20  # skip whitespace-only / trivial chunks


def chunk_file(file_path: str) -> List[Dict[str, Any]]:
    """Parse a file and return structured chunks with metadata."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        logger.debug("Could not read %s: %s", file_path, exc)
        return []

    if not content.strip() or len(content) < MIN_CHUNK_CHARS:
        return []

    try:
        if suffix == ".py":
            chunks = _chunk_python(content, file_path)
        elif suffix in {".js", ".ts", ".jsx", ".tsx"}:
            chunks = _chunk_javascript(content, file_path, suffix)
        elif suffix == ".json":
            chunks = [_chunk_whole(content, file_path, "json")]
        elif suffix == ".md":
            chunks = _chunk_markdown(content, file_path)
        else:
            return []
    except Exception as exc:
        logger.warning("Chunker failed on %s: %s — falling back to whole-file chunk", file_path, exc)
        chunks = [_chunk_whole(content, file_path, _language_for(suffix))]

    # Drop empty / trivially small chunks
    return [c for c in chunks if len((c["content"] or "").strip()) >= MIN_CHUNK_CHARS]


def chunk_files_parallel(file_paths: List[str], max_workers: int | None = None) -> List[Dict[str, Any]]:
    """Chunk many files concurrently. File I/O + AST parse release the GIL enough
    that ThreadPoolExecutor gives a real speedup without paying process-spawn cost."""
    if not file_paths:
        return []
    workers = max_workers or min(32, (os.cpu_count() or 4) * 2)
    all_chunks: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for chunks in pool.map(chunk_file, file_paths):
            all_chunks.extend(chunks)
    return all_chunks


def _language_for(suffix: str) -> str:
    return {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".jsx": "jsx", ".tsx": "tsx", ".json": "json", ".md": "markdown",
    }.get(suffix.lower(), "text")


def _make_chunk(content: str, file_path: str, language: str,
                function_name: str | None = None,
                chunk_type: str = "module",
                start_line: int | None = None,
                end_line: int | None = None) -> Dict[str, Any]:
    return {
        "content": content[:MAX_CHUNK_CHARS],
        "metadata": {
            "file_path": file_path,
            "file_name": Path(file_path).name,
            "function_name": function_name,
            "language": language,
            "chunk_type": chunk_type,
            "start_line": start_line,
            "end_line": end_line,
        },
    }


def _chunk_python(content: str, file_path: str) -> List[Dict[str, Any]]:
    chunks = []
    lines = content.splitlines()

    try:
        tree = ast.parse(content)
    except SyntaxError:
        return [_chunk_whole(content, file_path, "python")]

    # Compact import preamble (capped)
    import_segments = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            try:
                import_segments.append(ast.unparse(node))
            except Exception:
                pass
    preamble = "\n".join(import_segments)
    if len(preamble) > MAX_PREAMBLE_CHARS:
        preamble = preamble[:MAX_PREAMBLE_CHARS] + "\n# ...imports truncated..."
    if preamble:
        preamble += "\n\n"

    # Walk only top-level + class-level definitions to avoid duplicating methods.
    def walk_top_level(nodes, parent: str | None = None):
        for node in nodes:
            if isinstance(node, ast.ClassDef):
                yield (node, "class", parent)
                # Recurse into class body to collect methods (without re-yielding the class itself)
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        yield (child, "method", node.name)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                yield (node, "function", parent)

    seen_ranges: set[tuple[int, int]] = set()

    for node, chunk_type, parent in walk_top_level(tree.body):
        start = (node.lineno or 1) - 1
        end = node.end_lineno or len(lines)
        key = (start, end)
        if key in seen_ranges:
            continue
        seen_ranges.add(key)

        body = "\n".join(lines[start:end])
        if not body.strip():
            continue
        chunk_content = preamble + body if preamble else body
        name = node.name if not parent or chunk_type == "class" else f"{parent}.{node.name}"
        chunks.append(_make_chunk(
            chunk_content, file_path, "python",
            function_name=name,
            chunk_type=chunk_type,
            start_line=node.lineno,
            end_line=node.end_lineno,
        ))

    if not chunks:
        chunks.append(_chunk_whole(content, file_path, "python"))

    return chunks


_JS_DEF_RE = re.compile(
    r"""(?mx)
    ^\s*
    (?:export\s+)?(?:default\s+)?
    (?:
        (?:async\s+)?function\s+(?P<fn>\w+)\s*\(             # function foo(
        |
        (?:const|let|var)\s+(?P<arrow>\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+\s*)?=>  # const foo = (...) =>
        |
        class\s+(?P<cls>\w+)                                  # class Foo
    )
    """,
)


def _chunk_javascript(content: str, file_path: str, suffix: str) -> List[Dict[str, Any]]:
    language = _language_for(suffix)
    lines = content.splitlines()

    # Compact import preamble (capped)
    import_lines = [l for l in lines if l.strip().startswith(("import ", "import{", "import \"", "import '"))]
    preamble = "\n".join(import_lines)
    if len(preamble) > MAX_PREAMBLE_CHARS:
        preamble = preamble[:MAX_PREAMBLE_CHARS] + "\n// ...imports truncated..."
    if preamble:
        preamble += "\n\n"

    matches = []
    for m in _JS_DEF_RE.finditer(content):
        name = m.group("fn") or m.group("arrow") or m.group("cls")
        kind = "function" if (m.group("fn") or m.group("arrow")) else "class"
        line_num = content[:m.start()].count("\n")
        matches.append((line_num, name, kind, m.start()))

    matches.sort(key=lambda x: x[0])

    chunks = []
    for i, (start_line, name, kind, _) in enumerate(matches):
        end_line = matches[i + 1][0] if i + 1 < len(matches) else len(lines)
        body = "\n".join(lines[start_line:end_line]).strip()
        if not body:
            continue
        chunk_content = preamble + body if preamble else body
        chunks.append(_make_chunk(
            chunk_content, file_path, language,
            function_name=name,
            chunk_type=kind,
            start_line=start_line + 1,
            end_line=end_line,
        ))

    if not chunks:
        chunks.append(_chunk_whole(content, file_path, language))

    return chunks


def _chunk_markdown(content: str, file_path: str) -> List[Dict[str, Any]]:
    sections = re.split(r"(?m)^## ", content)
    if len(sections) <= 1:
        return [_chunk_whole(content, file_path, "markdown")]

    chunks = []
    for i, section in enumerate(sections):
        if not section.strip():
            continue
        heading = section.split("\n", 1)[0].strip() if i > 0 else "intro"
        chunks.append(_make_chunk(
            section, file_path, "markdown",
            function_name=heading or "section",
            chunk_type="section",
        ))
    return chunks


def _chunk_whole(content: str, file_path: str, language: str) -> Dict[str, Any]:
    return _make_chunk(content, file_path, language, chunk_type="module")
