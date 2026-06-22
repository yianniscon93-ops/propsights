---
description: Start, stop, or check status of the FastAPI development server
---

Manage the FastAPI development server for the BnB STR intelligence platform.

- The FastAPI app will live at `api/main.py` (or `api/` directory) once built
- Default port: 8000
- Run with: `uvicorn api.main:app --reload`

Based on $ARGUMENTS:
- If "start" or empty: start the FastAPI dev server in the background, show the URL
- If "stop": find and kill the uvicorn process
- If "status": check if the server is running and show recent logs

If the FastAPI app doesn't exist yet, say so and offer to start building Phase 1 of the product roadmap (FastAPI layer over DuckDB).
