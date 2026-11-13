"""Canonical office rooms and the role → room mapping.

The backend stores these room ids on agents/events; the 3D scene (frontend officeLayout)
uses the same ids for geometry, doors and waypoints. Keep the two lists in step — a room the
orchestrator can name must exist on the floor plan, and vice versa.

  lobby    — Entrance, reception desk and visitor seating
  cs       — Customer Service counters
  dev      — Programmer / Development floor
  server   — Server & Database (restricted, glass-fronted)
  analyst  — Analyst / Research
  design   — Design studio
  admin    — Administration / Operations
  security — Security control room (restricted)
  pantry   — Pantry and break area
  meeting  — Meeting room (travel destination, not a home department)
"""

ROOM_IDS = (
    "lobby", "cs", "dev", "server", "analyst",
    "design", "admin", "security", "pantry", "meeting",
)

# Which department each role belongs to. Keys match app.plan_schema.ROLES exactly so the
# roster stays the single source of truth. Lobby, security and pantry are staffed by people
# whose home is elsewhere, so no role is parked there permanently.
ROLE_ROOM: dict[str, str] = {
    "Frontend Developer": "dev",
    "Backend Developer": "dev",
    "Developer": "dev",
    "QA Engineer": "dev",
    "Data Analyst": "server",
    "Researcher": "analyst",
    "Product Analyst": "analyst",
    "UI/UX Designer": "design",
    "Content Creator": "design",
    "Administrator": "admin",
    "Reviewer": "admin",
    "AI Coordinator": "admin",
    # Simulation-only staff. Not in plan_schema.ROLES, so the planner never binds a
    # project step to them; their rooms are their duty posts.
    "Housekeeping": "pantry",
    "Security": "security",
}

OPERATIONAL_ROLES: frozenset[str] = frozenset({"Housekeeping", "Security"})


def is_operational_role(role: str | None) -> bool:
    """Office-staff roles that exist only for the simulation, never for project work."""
    return (role or "") in OPERATIONAL_ROLES


def room_for_role(role: str | None) -> str:
    """Home room for a role; unknown roles default to the open administration area."""
    return ROLE_ROOM.get(role or "", "admin")
