---
name: Frontend dev/verification quirks (Vite + Replit)
description: Non-obvious gotchas when adding map libs and verifying time-based UI in this Vite+pnpm+Replit setup
---

## react-leaflet first-load "Invalid hook call / multiple copies of React"
When first adding react-leaflet (v5) to a Vite artifact, a partial HMR update can throw
"Invalid hook call... more than one copy of React" / "Cannot read properties of null (reading 'useState')"
originating in `MapContainerComponent`. It clears after a **full page reload** (workflow restart).

**Why:** Vite re-optimizes deps when the map lib is added; a partial HMR swap leaves a transient
second React instance. A full reload re-bundles everything against the deduped React.

**How to apply:** If `resolve.dedupe: ['react','react-dom']` is already in the vite config (it is, for landing),
do NOT chase this as a real dedupe/config bug. Restart the workflow / hard reload and re-check before changing config.

## The app_preview screenshot tool reloads the page fresh each capture
Each `screenshot` (app_preview) navigates to the URL fresh (you can see `[vite] connecting...` in console each time),
so it always captures the **initial state** of an auto-playing/looping animation — never a later frame.

**How to apply:** To verify later stages of a self-advancing sequence, temporarily change the component's
initial state (e.g. the initial `stageIdx`) via an HMR edit, screenshot, then revert. Don't rely on `sleep`
between screenshots to catch a mid-sequence frame.

## Leaflet panes paint OVER sibling React overlays unless the map is isolated
When React overlays (captions, draw spotlight, chips) are siblings of a react-leaflet map inside the same
positioned container, Leaflet's internal panes (z-index ~400-700) render ABOVE your overlays even when the
overlays have a higher z-index like z-10/z-20 — the overlay simply appears hidden behind the tiles/markers.

**Why:** z-index only compares within the same stacking context. Leaflet establishes its panes at high z
INSIDE the map; sibling overlays compete in the parent context and lose to the already-painted panes.

**How to apply:** Give the map's wrapper div `isolation: isolate` (CSS `isolation:"isolate"`). That creates a
new stacking context so the map's panes can't escape above siblings; your z-10/z-20 overlays then sit on top.
Do NOT just crank overlay z-index higher — it won't help across stacking contexts.
