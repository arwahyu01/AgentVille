# AgentVille — Green Tech Campus Implementation Plan

Status: **complete** (stages 0–7 verified; approved by user on 2026-10-25).
Scope source: `PROMPT AGENTVILLE GREEN TECH CAMPUS.md`.

This file is the resumable work plan. Tick a stage only after its actual
verification (build, browser render, or automated test) has passed.

## Guardrails

- No changes to `backend/**`, `data/workspace/project-*`, AI orchestration,
  Telegram, approvals, scheduler, or agent data.
- No reading/printing `.env`, tokens, or credentials.
- Preserve the ten office zones, agent identity/count, backend status/events,
  agent selection, detail panel, and the no-WebGL fallback.
- Do not invent work animations. Motion stays driven by backend state/events.
- Do not call the campus "open world". The campus is a bounded, compact area.

## Approved target decisions

- Front of the building is the **south facade** (`z = +9`).
- Main entrance centre: `x = -10.2`, `z = +9`, opening 2.6 m wide.
- Lobby spawn: just inside the entrance, in the clear aisle in front of the
  reception desk.
- Reception desk is turned to face the entrance; the waiting cluster moves to
  the east side so the entrance → desk aisle is clear.
- One `Canvas`, one renderer, one agent set. Camera modes only change camera
  and visibility of groups; agent/event state is never reset.
- Campus is compact and bounded (~120 m square). Hills are visible landscape,
  not a playable area.

## Stages and checkpoints

### Stage 0 — Audit (done)

- [x] Read the full prompt.
- [x] Inspect `OfficeScene.tsx`, `officeLayout.ts`, `Structure.tsx`,
      `RoomFitout.tsx`, `Furniture.tsx`, `AgentFigure.tsx`, `Lighting.tsx`,
      `App.tsx`, `types.ts`, `styles.css`, `backend/app/rooms.py`.
- [x] Run backend/frontend and capture real browser renders.
- [x] Verify agent raycast selection and `.selected-agent` data.
- [x] Record that the current Explore is only an eye-height orbit.

### Stage 1 — Entrance, lobby, plan (critical)

- [x] Add `ENTRANCE` contract to `officeLayout.ts` (south facade, width,
      spawn, plaza edge).
- [x] Punch the entrance through the south curtain wall; add portal, canopy,
      open glass leaves, threshold and facade signage.
- [x] Rotate/reposition the reception desk to face the entrance (west wall,
      `rotationY = HALF_PI`, facing east; backdrop sign reads "AGENTVILLE").
- [x] Move the waiting cluster clear of the entrance aisle (east side).
- [x] Move lobby staff anchors out from behind the reception backdrop.
- [x] Move corridor plants/bench off the walking spine.
- [x] Add geometry/collision tests for entrance, spawn and clear aisle
      (`collision.test.ts`: entrance aisle, plaza→door→lobby→corridor BFS,
      straight guest lane).
- [x] Verify with a render from the plaza and a walk from the door to reception
      (see Stage 7 evidence).

### Stage 2 — Interior quality

- [x] Extend the palette (stone, charcoal, teal, warm white, oak, green).
- [x] Upgrade workstation details (mouse, armrest, grommets, cables).
- [x] Add department floor/carpet/acoustic accents without over-decorating.
- [x] Verify chair/monitor/keyboard orientation per zone from rendered close-ups.
- [x] Tune seated arm pose so hands are readable on the keyboard; typing motion
      remains gated by backend `working` status.
- [x] Rebalance daylight/practicals; avoid blown-out white surfaces.
- [x] Verify all ten zones and agent picking after the changes.

### Stage 3 — Campus blockout

- [x] Add `lib/campusLayout.ts` with bounded site data (plaza, drop-off, road,
      sidewalks, park, river, bridge, café, parking, Innovation District, hills).
- [x] Add `lib/collision.ts` with pure circle/AABB movement, wall/door
      colliders, water exclusion, bridge height and campus bounds.
- [x] Build plaza directly in front of the real entrance and a path that ends
      at the door.
- [x] Build a road network that never crosses the office or other solids.
- [x] Build a compact park, river/riverwalk/bridge and outdoor café.
- [x] Build parking with solar canopy, EV points, bike rack and static cars.
- [x] Add distant layered hills + fog.
- [x] Render blockout and check scale/circulation before detail art.

### Stage 4 — Campus detail and office shell

- [x] Instanced trees/shrubs/lamps/road dashes.
- [x] Stylised animated water (procedural texture offset), waterfall/foam,
      stone banks and bridge railings.
- [x] Innovation District façades; buildings are decorative/closed.
- [x] Café pergola, tables, seating and planters.
- [x] Parking markings, canopy, chargers, bikes and static cars.
- [x] Office roof/parapet/dormer massing for Campus View; hidden in Office View.
- [x] No object blocks the entrance, paths, river, or landmark sightline.

### Stage 5 — Camera modes, Explore, collision, transition

- [x] Replace `isometric | explore` with `campus | office | explore`.
- [x] Campus View: orbit/pan/zoom over the whole bounded campus.
- [x] Office View: current interior orbit + zone focus + agent picking.
- [x] Explore: real first-person with pointer lock, WASD, Shift, Escape,
      clamped pitch, delta-time movement, diagonal normalisation and focus-loss
      handling.
- [x] Drag/touch look and on-screen movement fallback for devices without a
      keyboard/mouse.
- [x] Collision with walls, door gaps, furniture, trees, planters, buildings,
      river banks and campus bounds.
- [x] Walk through the actual main entrance; no teleport through a fake door.
- [x] Keep agent state, selection, event stream and renderer intact when
      switching modes.
- [x] Visible exit control and entrance proximity hint.

### Stage 6 — Performance and modularity

- [x] Keep campus geometry, nature, buildings, camera and collision in separate
      modules; no mega-component.
- [x] Reuse geometry/materials; InstancedMesh for repeated props.
- [x] Limit shadow casters/maps and per-object `useFrame` (ambience fans and the
      wall clock each add exactly one frame callback).
- [x] Cull campus/interior groups by camera mode where safe.
- [x] Remove listeners on unmount; no per-frame material allocation.
- [x] Preserve fallback when WebGL is unavailable.
- [x] Optional QA-only debug hook behind a query parameter to expose player
      position and draw calls for Playwright tests.

### Stage 7 — Verification and final report

- [x] `npm run lint` — 0 errors (16 pre-existing warnings).
- [x] `npm run test` — 6 files, 78 tests pass (13 collision).
- [x] `npm run build` — succeeds (pre-existing 1.45 MB chunk warning only).
- [x] Browser console check (desktop and narrow viewport) — only the SwiftShader
      `GPU stall due to ReadPixels` warning.
- [x] Real renders: campus view, office view, explore at entrance, inside lobby,
      mobile.
- [x] Walk tests: plaza → door → lobby → corridor; return outside.
- [x] Collision tests: wall, door, river, bridge, tree, building.
- [x] Agent selection + detail panel + backend status/event still work.
- [x] No-WebGL fallback still works (14 agent rows, 0 errors).
- [x] Measure draw calls/FPS; report SwiftShader limitations honestly.
- [x] Update this file with final status and evidence paths.

## Verification notes

- Frontend: `cd frontend && npm run test && npm run lint && npm run build`.
- Backend tests are only needed if a backend file is touched (none planned).
- Browser harness: `.qoder/shot.py` with the Python that has Playwright installed.
- Keep generated screenshots outside the repo, under
  `C:\Users\User\AppData\Local\Temp\opencode\`.

## Session addendum — textures, characters, bustle, teller/CS, game HUD

Extra requests handled after the stages above (all within scope; no backend,
agent-data, or roster change):

- **Procedural textures** (`frontend/src/features/office/textures.ts`): timber
  grain, upholstery weave, floor tile, grass/road/water, applied through the
  cached `map` on `mat()` in `Furniture.tsx`, `Structure.tsx`, `CampusGround.tsx`,
  `CampusKit.tsx`. No binary assets, no new dependencies.
- **Cartoon humans** (`AgentFigure.tsx`): real faces (eyes, brows, nose, lips,
  blush), five hairstyles + beard, glasses, role-keyed shirts, ties, teller vest
  + badge, staff caps. Skin/hair/clothes are deterministic per agent id/role —
  never random per frame.
- **Office bustle, honestly** (`Ambience.tsx`, `Furniture.tsx` `WallClock`,
  `OfficeScene.tsx` badge): rotating ceiling fans (pantry + meeting room) and
  wall-clock hands that follow the real time are pure environment. The scene
  badge prints the **real** working count (`N WORKING NOW`), and typing/mopping
  motion stays gated on backend `working` status. No invented work animation.
- **Teller hall + CS** (`RoomFitout.tsx` `ServiceFloor`, `collision.ts`):
  glazed teller windows with document slots, counter run, queue stanchions and
  tape, three CS consultation desks, waiting bench. Fit-out only — the teller is
  **not** a new agent (spec line 74), so no agent is stationed in `cs`.
- **Game-style HUD** (`OfficeScene.tsx` `AgentDialog`, `activity.ts`
  `workBrief`/`taskOfAgent`, `styles.css`): clicking a person opens an on-canvas
  dialogue box with avatar, live status, what they're doing, task title and a
  progress bar + step. Built only from real agent/task/event rows.

### Honest limitation

At the time of writing only **2 of 14** agents are `working` (Housekeeping and
Security, from the live DB). The scene reflects exactly that — the badge reads
`2 WORKING NOW` and the other twelve rest at their desks. This is deliberate per
the guardrail *"do not invent work animations"*; the fix is more real work in the
backend, not fake motion in the scene.

### Evidence (screenshots under `.qoder/shots/`)

- `hud-office.png`, `hud-760.png` — game HUD with real task ("Lakukan QA pada
  landing page", 8% · step #4) at desktop and at the 760 px breakpoint.
- `cs-teller.png`, `cs-teller-close.png` — Customer Service teller hall.
- `lobby-west.png` — relocated "AGENTVILLE" reception facing the entrance.
- `campus-view.png`, `explore-view.png` — campus orbit and first-person entrance.
- `pantry-fan.png` — ceiling fan + `2 WORKING NOW` badge.
- `narrow-office.png` — 420 px layout.
- `fallback-after.png` — no-WebGL list fallback (14 rows).

### Browser-walk evidence (`campus_check.py`, real key events)

```
EXPLORE START {'x': '-10.20', 'z': '18.00', 'inside': '0'}   # plaza spawn
APPROACH      {'x': '-10.20', 'z': '10.78', 'inside': '0'}   # proximity hint shown
AFTER WALK    {'x': '-10.20', 'z':  '3.27', 'inside': '1'}   # through the real door
PUSH DESK     {'x': '-10.20', 'z': '-1.24', 'inside': '1'}   # into the corridor
BACK OUT      {'x': '-10.20', 'z': '16.45', 'inside': '0'}   # straight back outside
AFTER ESC     {'mode': 'campus', 'locked': '0'}              # Escape frees the mouse
FPS ~17 (SwiftShader software rasteriser), CONSOLE 1 (ReadPixels perf warning only)
```
