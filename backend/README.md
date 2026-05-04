---
title: CodeSage Backend
emoji: 🧠
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# CodeSage Backend

FastAPI service that powers CodeSage — clones a GitHub repo, chunks + embeds it,
stores vectors in Pinecone, and answers questions over the resulting index using
an LLM via the Hugging Face Inference API.

## Required secrets

Set these in **Settings → Variables and secrets** (as *secrets*, not variables):

- `PINECONE_API_KEY` — your Pinecone API key
- `HUGGINGFACE_API_KEY` — HF Inference API token with read access to the chosen LLM

## Optional environment variables

Set these as *variables* (non-secret):

- `PINECONE_INDEX_NAME` — defaults to `codesage`
- `EMBEDDING_MODEL` — defaults to `sentence-transformers/all-MiniLM-L6-v2`
- `LLM_MODEL` — defaults to `Qwen/Qwen2.5-7B-Instruct`
- `ALLOWED_ORIGINS` — comma-separated CORS origins (set to your Vercel URL in prod)
- `GITHUB_TOKEN` — optional, raises GitHub API rate limits from 60 → 5000/hr
- `LOG_LEVEL` — defaults to `INFO`
- `WARMUP_EMBEDDER` — `1` to pre-load the embedding model on boot

## Health check

`GET /health` returns `{ "status": "ok" }` once required secrets are present.
