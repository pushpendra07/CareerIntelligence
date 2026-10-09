---
description: Add a database table or column with an Alembic migration
---

1. Add or change the SQLAlchemy model in `backend/app/models/` and export new models in
   `backend/app/models/__init__.py`.
2. Find the current head: `cd backend && grep -h "^revision\|^down_revision" alembic/versions/*.py`
   (the head is the revision nobody uses as `down_revision`).
3. Create `backend/alembic/versions/<YYYYMMDD>_<revision>_<name>.py` with `revision`,
   `down_revision = <head>`, and explicit `upgrade()` / `downgrade()` (follow existing files:
   named constraints via `op.f(...)`, JSONB server defaults like `sa.text("'{}'::jsonb")`).
4. Run the backend tests — the test database is rebuilt from migrations, so a broken
   migration fails immediately:
// turbo
   `cd backend && uv run pytest -q`
5. Apply it to the dev database by restarting: `./stop.sh --keep-db && ./start.sh --no-open`.
