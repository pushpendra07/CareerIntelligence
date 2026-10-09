---
description: Start, restart or stop Career Intelligence locally
---

1. Start everything (dev PostgreSQL, migrations, API on 8010, UI on 5173):
// turbo
   `./start.sh --no-open`
2. Open http://127.0.0.1:5173 (API docs: http://127.0.0.1:8010/docs).
3. After backend code changes or new migrations, restart the API (the UI hot-reloads):
// turbo
   `./stop.sh --keep-db && ./start.sh --no-open`
4. If something fails, read `.run/logs/backend.log` and `.run/logs/frontend.log`.
5. To stop everything including the database: `./stop.sh`.
   Never stop the app on port 8000 — it is a different project.
