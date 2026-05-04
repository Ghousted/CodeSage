import logging
import os
import threading
import time
from typing import List, Dict, Any, Optional
from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError, InferenceTimeoutError

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a senior engineer answering questions about a specific codebase. Use ONLY the retrieved code snippets provided with the current question — never invent files, functions, or behavior that is not shown.

You may reference earlier turns in this conversation to keep continuity (e.g. "expanding on the X function from before"). But every new claim must be grounded in the retrieved code attached to the current question, not the previous turn.

## Response format

Respond in well-formed Markdown using this exact structure. Skip any section that does not apply.

### Answer
A direct 1-3 sentence answer to the question. Lead with the conclusion, not the reasoning.

### How it works
A clear explanation of the relevant code paths. Reference specific files inline using backticks like `path/to/file.py` and call out function or class names. Use short paragraphs or a numbered list when describing a sequence of steps.

### Key code
For each piece of code worth showing, use this format:

**`relative/path/to/file.ext`** — one-line description of what this snippet does
```language
// the snippet (keep it short — 5 to 20 lines, trim irrelevant parts with `// ...`)
```

Show at most 3 snippets. Pick the most load-bearing ones, not every match.

### Caveats (only if relevant)
A short note if:
- The retrieved context is insufficient to fully answer the question
- There is conflicting code or unclear behavior
- The answer depends on configuration or runtime state not visible in the code

## Rules
- If the context does not contain enough information, say so plainly in the **Answer** section. Do NOT guess.
- Never reference a file that does not appear in the retrieved code attached to the current question.
- Keep prose tight. Engineers want signal, not filler.
"""

_USER_TURN_TEMPLATE = """## Retrieved code

{context}

## Question

{question}"""

_QUERY_REWRITE_PROMPT = """Given the conversation below and a follow-up question, write a single self-contained search query that captures what the user is asking about.

Rules:
- Output ONLY the rewritten query as plain text. No explanation, no quotes, no preamble.
- If the follow-up is already self-contained, output it unchanged.
- Resolve pronouns and references ("it", "that function", "those routes", "the same file") using the conversation.
- Keep it under 30 words.

## Conversation so far

{history}

## Follow-up question

{question}

## Standalone query"""

# Rewrite is a small, fast LLM call — keep its output short.
QUERY_REWRITE_MAX_TOKENS = 80
QUERY_REWRITE_MAX_OUTPUT_CHARS = 500

# Cap how much prior conversation we replay back to the LLM. Each prior turn eats
# tokens that could otherwise hold retrieved code, so we trim aggressively.
MAX_HISTORY_MESSAGES = 6
MAX_HISTORY_CHARS_PER_MSG = 1500

# Approx. char budget for the full prompt context (≈ token-safe for 8k-context models)
MAX_CONTEXT_CHARS = 12_000
MAX_CHUNK_CHARS_IN_CONTEXT = 2_500
LLM_MAX_NEW_TOKENS = 1024
LLM_TEMPERATURE = 0.1
LLM_RETRIES = 3
LLM_RETRY_BACKOFF = 3.0

_client_lock = threading.Lock()
_client: InferenceClient | None = None


class LLMConfigError(RuntimeError):
    pass


class LLMUnavailableError(RuntimeError):
    pass


def _get_client() -> InferenceClient:
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            api_key = os.environ.get("HUGGINGFACE_API_KEY")
            if not api_key:
                raise LLMConfigError("HUGGINGFACE_API_KEY is not set")
            _client = InferenceClient(token=api_key, timeout=60)
    return _client


def _model_name() -> str:
    return os.getenv("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct")


def _chat_complete_messages(messages: List[Dict[str, str]], *, max_tokens: int = LLM_MAX_NEW_TOKENS) -> str:
    """Call the HF Inference API with a full multi-message conversation. Retries on transient errors."""
    client = _get_client()
    model = _model_name()
    last_err: Exception | None = None

    for attempt in range(1, LLM_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=LLM_TEMPERATURE,
            )
            text = (response.choices[0].message.content or "").strip()
            if not text:
                raise LLMUnavailableError("LLM returned an empty response")
            return text
        except (InferenceTimeoutError, HfHubHTTPError) as exc:
            last_err = exc
            status = getattr(exc, "response", None)
            status_code = getattr(status, "status_code", None) if status is not None else None
            # Don't retry auth / not-found errors
            if status_code in {401, 403, 404}:
                raise LLMUnavailableError(
                    f"LLM model {model!r} is not accessible (HTTP {status_code}). "
                    f"Set LLM_MODEL to a model your HF token can access."
                ) from exc
            wait = LLM_RETRY_BACKOFF * attempt
            logger.warning("LLM call failed (attempt %d/%d): %s — retrying in %.1fs",
                           attempt, LLM_RETRIES, exc, wait)
            time.sleep(wait)
        except Exception as exc:
            last_err = exc
            logger.warning("LLM call raised %s — retrying", type(exc).__name__)
            time.sleep(LLM_RETRY_BACKOFF * attempt)

    raise LLMUnavailableError(f"LLM call failed after {LLM_RETRIES} attempts: {last_err}")


def _chat_complete(prompt: str, *, max_tokens: int = LLM_MAX_NEW_TOKENS) -> str:
    """One-shot single-prompt wrapper used by callers that don't need history (e.g. summarizer)."""
    return _chat_complete_messages(
        [{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )


def _normalize_history(history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    """Clip a client-supplied history to the most recent N messages and trim each."""
    if not history:
        return []
    cleaned: List[Dict[str, str]] = []
    for m in history:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        if len(content) > MAX_HISTORY_CHARS_PER_MSG:
            content = content[:MAX_HISTORY_CHARS_PER_MSG] + "\n...[truncated]"
        cleaned.append({"role": role, "content": content})
    # Keep the tail (most recent context matters most)
    return cleaned[-MAX_HISTORY_MESSAGES:]


def rewrite_query_with_history(
    question: str,
    history: Optional[List[Dict[str, str]]],
) -> str:
    """Condense a follow-up question + chat history into a self-contained search query.

    Falls back to the literal question if history is empty or the rewrite call fails —
    we never want this step to block answering.
    """
    normalized = _normalize_history(history)
    if not normalized:
        return question

    history_text = "\n\n".join(
        f"{m['role'].capitalize()}: {m['content']}" for m in normalized
    )
    prompt = _QUERY_REWRITE_PROMPT.format(history=history_text, question=question)

    try:
        rewritten = _chat_complete(prompt, max_tokens=QUERY_REWRITE_MAX_TOKENS).strip()
    except (LLMConfigError, LLMUnavailableError) as exc:
        logger.warning("Query rewrite failed (%s) — using literal question", exc)
        return question

    # Defensive: if the model went off-rails (returned an essay, JSON, etc.), fall back.
    if not rewritten or len(rewritten) > QUERY_REWRITE_MAX_OUTPUT_CHARS:
        return question
    return rewritten


def _format_context(chunks: List[Dict[str, Any]]) -> str:
    """Render chunks into a labelled prompt block. Truncates to fit MAX_CONTEXT_CHARS."""
    parts: List[str] = []
    used_chars = 0

    for i, chunk in enumerate(chunks, start=1):
        meta = chunk["metadata"]
        file_path = meta.get("file_path", "unknown")
        func = meta.get("function_name")
        label = f"{file_path}" + (f" — {func}" if func else "")
        body = chunk.get("content", "") or ""
        if len(body) > MAX_CHUNK_CHARS_IN_CONTEXT:
            body = body[:MAX_CHUNK_CHARS_IN_CONTEXT] + "\n# ... (truncated)"
        block = f"### [{i}] {label}\n```\n{body}\n```"
        if used_chars + len(block) > MAX_CONTEXT_CHARS and parts:
            parts.append(f"\n# ... ({len(chunks) - i + 1} more chunks omitted to fit context)")
            break
        parts.append(block)
        used_chars += len(block)

    return "\n\n".join(parts)


def generate_answer(
    question: str,
    chunks: List[Dict[str, Any]],
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Run the RAG chain: format context + replay prior turns, call LLM, return structured output."""
    context = _format_context(chunks)
    user_turn = _USER_TURN_TEMPLATE.format(context=context, question=question)

    messages: List[Dict[str, str]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    messages.extend(_normalize_history(history))
    messages.append({"role": "user", "content": user_turn})

    answer = _chat_complete_messages(messages)

    source_files = []
    seen = set()
    for chunk in chunks:
        fp = chunk["metadata"].get("file_path")
        if fp and fp not in seen:
            seen.add(fp)
            source_files.append(fp)

    return {
        "answer": answer,
        "source_files": source_files,
        "chunks_used": [
            {
                "file_path": c["metadata"].get("file_path"),
                "function_name": c["metadata"].get("function_name"),
                "content": c["content"],
                "score": c.get("score"),
            }
            for c in chunks
        ],
    }


def call_llm(prompt: str, max_tokens: int = 512) -> str:
    """Public helper for other modules (summarizer) to issue a one-shot prompt."""
    return _chat_complete(prompt, max_tokens=max_tokens)
