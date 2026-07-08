# Agent conventions

This project uses [soly](https://github.com/lowern1ght/pi-soly) for project management.

## Quick reference

- `/plan N` — plan phase N
- `/execute N.MM` — execute plan MM in phase N
- `/inspect` — see current state
- `/pause` — save handoff for later
- `/resume` — restore from handoff

## State

- `.agents/ROADMAP.md` — phase table
- `.agents/STATE.md` — current position + decisions
- `.agents/docs/` — intent docs (vision, architecture, ...)
- `.agents/rules/` — project rules (style, testing, ...)
- `.agents/phases/<NN>-<slug>/` — one dir per phase
- `.agents/HANDOFF.json` — pause snapshot
