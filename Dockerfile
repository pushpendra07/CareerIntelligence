# Career Intelligence: one image with the API and the built web UI, served on one port (8010).
#   docker compose up -d        (see docker-compose.yml and ./install.sh)

# --- 1. Build the web UI ------------------------------------------------------------------
FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2. The app ---------------------------------------------------------------------------
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv

# pg_dump 16 (same major version as the database) for full backups in Settings → Backup & import.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" \
    STATIC_DIR=/app/ui STORAGE_PATH=/data/storage BACKUP_PATH=/data/backups \
    LOGIN_FILE=/data/secrets/login.json \
    LOG_FORMAT=json PYTHONUNBUFFERED=1
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
RUN uv sync --frozen --no-dev
COPY --from=ui /ui/dist /app/ui
COPY browser-extension/ /app/browser-extension/

# Run as a normal user; /data (CVs and backups) is a volume it owns.
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data/storage /data/backups && chown -R app /data
USER app
VOLUME ["/data"]
EXPOSE 8010
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fs http://127.0.0.1:8010/api/v1/health || exit 1
# Apply database migrations, then serve the API and the UI.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8010 --proxy-headers"]
