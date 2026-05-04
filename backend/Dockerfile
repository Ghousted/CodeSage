FROM python:3.11-slim

# git is required by gitpython for cloning user repos
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# HF Spaces convention: run as non-root user with UID 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR $HOME/app

# Install CPU-only torch first from the dedicated CPU wheel index so we don't
# pull the multi-GB CUDA build that the default PyPI torch ships with.
RUN pip install --user torch --index-url https://download.pytorch.org/whl/cpu

# Now install everything else. Because torch is already satisfied at a CPU
# version, pip won't reinstall it from the default index.
COPY --chown=user requirements.txt .
RUN pip install --user -r requirements.txt

# Pre-download the default embedding model so the first request isn't slow.
# (Override EMBEDDING_MODEL in Space secrets if you want a different one.)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy application code
COPY --chown=user . .

# HF Spaces routes external traffic to whatever port the README declares
# (we set app_port: 7860 in README.md frontmatter).
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
