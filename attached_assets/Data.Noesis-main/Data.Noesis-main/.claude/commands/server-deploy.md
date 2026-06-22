---
description: Push local changes to GitHub and pull on the Hetzner server
---

Deploy the latest changes to the production server:

1. Check git status to see what's changed locally
2. If there are uncommitted changes, ask the user if they want to commit first
3. Run: `ssh root@204.168.209.175 "cd /opt/bnb_git && git pull"` to pull latest on server
4. Confirm the server is on the correct commit by running: `ssh root@204.168.209.175 "cd /opt/bnb_git && git log --oneline -3"`

Server: root@204.168.209.175
Repo path: /opt/bnb_git
