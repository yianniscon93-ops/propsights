---
description: Start, stop, or check status of the Next.js development server
---

Manage the Next.js development server for the BnB STR intelligence platform frontend.

- The Next.js app will live at `frontend/` directory once built
- Default port: 3000
- Run with: `cd frontend && npm run dev`

Based on $ARGUMENTS:
- If "start" or empty: start the Next.js dev server in the background, show the URL
- If "stop": find and kill the Next.js process
- If "status": check if the server is running

If the Next.js app doesn't exist yet, say so and offer to start building Phase 2 of the product roadmap (Next.js frontend replacing the static dashboard).
