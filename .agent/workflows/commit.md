---
description: Commit a finished change safely (owner authorship, no personal data)
---

1. Run `.agent/workflows/run-checks.md` and make sure everything passes.
2. `git status --short` — confirm no `.env`, CVs/PDFs, `storage/`, `backend/.devdb/`, `.run/`,
   exports or other personal files are staged.
3. Commit with a clear message (what changed and why). Use the configured git identity.
   Do **not** add `Co-Authored-By`, "Generated with …" or any AI attribution lines.
4. Ask the user before `git push`. Never force-push or rewrite history without explicit approval.
