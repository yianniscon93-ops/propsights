---
name: dashboard
description: Start, stop, or check status of the full dashboard stack (FastAPI backend on Hetzner + Next.js frontend locally)
---

# Dashboard Management

Manage the full dashboard stack based on the user's request.

## Services

1. **FastAPI backend** — runs on Hetzner server (204.168.209.175) as systemd service `bnb-api` on port 8000
2. **Next.js frontend** — runs locally in `~/vscode/bnb/frontend` on port 3000

## Commands by action

### "start" (or no argument)

1. Start the backend:
   ```bash
   ssh root@204.168.209.175 "systemctl start bnb-api && systemctl is-active bnb-api"
   ```
2. Start the frontend in background:
   ```bash
   cd /Users/yiannisconstantinides/vscode/bnb/frontend && npm run dev
   ```
   Run `npm run dev` in the background so it doesn't block.
3. Show the user:
   - Frontend: http://localhost:3000
   - API: http://204.168.209.175:8000

### "stop"

1. Stop frontend: find and kill the Next.js dev process (`pgrep -f "next dev"`)
2. Stop backend: `ssh root@204.168.209.175 "systemctl stop bnb-api"`

### "status"

1. Check frontend: `pgrep -f "next dev"`
2. Check backend: `ssh root@204.168.209.175 "systemctl is-active bnb-api"`
3. Report which services are up/down

## Important

- NEVER use raw `uvicorn` on the server — always use `systemctl start/stop/restart bnb-api`
- The Next.js frontend connects to the remote API via `NEXT_PUBLIC_API_BASE` in `.env.local`
- DuckDB allows only one writer — if backend is running, don't run write scripts on the server without stopping it first
