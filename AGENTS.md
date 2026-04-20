# Repository Guidelines

## Project Structure & Module Organization
- `app.py`: Flask application entrypoint, routes, auth, admin actions, and API endpoints.
- `models.py`: SQLAlchemy models (`User`, `Playlist`, `PlaylistItem`).
- `utils/`: external service clients (`youtube.py`, `lastfm.py`, `soundcharts.py`) and `translations.json`.
- `templates/`: Jinja2 pages (`index.html`, `playlist.html`, auth/admin views).
- `static/css`, `static/js`: frontend styles and vanilla JS modules.
- `instance/songfinder.db`: local SQLite database file (runtime data).
- Deployment files: `Dockerfile`, `docker-compose.yml`, `.env` (secrets/config).

## Build, Test, and Development Commands
- `pip install -r requirements.txt`: install Python dependencies.
- `docker compose up --build`: build and run the app on `http://localhost:5000`.
- `gunicorn --workers 3 --bind 0.0.0.0:5000 app:app`: production-like local run.
- `python3 -m py_compile app.py`: quick backend syntax check.
- `node --check static/js/search.js`: quick frontend syntax check for edited JS files.

Note: `python app.py` expects TLS files in `ssl/cert.pem` and `ssl/key.pem`.

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for models/classes.
- JavaScript: 4-space indentation, `camelCase` for variables/functions, descriptive DOM IDs/classes.
- Keep route handlers and utility clients focused; avoid mixing external API logic into templates.
- Prefer small, targeted edits in existing files over broad refactors.

## Testing Guidelines
- No formal test suite is currently configured.
- Before PR, run syntax checks (`py_compile`, `node --check`) and manually verify:
  1. search across sources (`youtube`, `lastfm`, `soundcharts`)
  2. playlist add/remove/reorder
  3. auth/admin-protected routes
- If adding non-trivial logic, include reproducible manual test steps in the PR description.

## Commit & Pull Request Guidelines
- Current history uses short, focused commit messages (often Czech), e.g. `js fix`, `oprava api`.
- Recommended format: `<area>: <what changed>` (example: `search: fix URL query bootstrap`).
- Keep commits scoped to one concern; avoid unrelated file churn.
- PRs should include:
  1. what changed and why
  2. impacted files/routes
  3. setup/migration notes (`.env`, DB, API keys)
  4. screenshots/GIFs for UI changes.

## Security & Configuration Tips
- Never commit real secrets from `.env` (API keys, `SECRET_KEY`).
- Keep `instance/songfinder.db` and generated artifacts out of commits unless explicitly needed.
