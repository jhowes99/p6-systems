# Workspace Rebuild — Implementation Plan

Tied to [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md).  
Aligned with Master Spec Parts 20–22. **One phase at a time.**

---

## Preserve list (non-negotiable)

1. `web/landing.html` + `landing.css` visual foundation  
2. Working VirtualPLC / Water Transfer / FAT / OPC UA / MQTT / canonical model  
3. Existing Express APIs — extend, don’t fork  
4. Docker modular monolith (`p6-app`)

---

## Phase plan

| Phase | Goal | Exit criteria | Depends on |
|------:|------|---------------|------------|
| **0** | Audit | ARCHITECTURE_AUDIT + this plan + BUILD_PROGRESS | — |
| **1** | Studio shell | ✅ MVP | 0 |
| **2** | Sample plant graph | ✅ symbols, zoom/pan/fit, drag | 1 |
| **3** | Runtime in Studio | ✅ command API + rejects + events | 2 |
| **4** | Persistence | ✅ graph SoR + autosave | 3 |
| **5** | Document ingestion | ◐ linked flows; side-by-side review open | 4 |
| **6** | Verify in Studio | ✅ Run FAT in shell | 3+ |
| **7** | Connect console | ✅ status panel in Studio | 3+ |
| **8** | UX polish | ✅ motion toggle, badges, symbols | 3–7 |
| **9** | Validation | ✅ smoke_studio_e2e 12/12 + Docker | all |

### Frontend technology decision (Phase 1–2)

**Phase 1–2 stay vanilla JS** (no React build pipeline today).  
Re-evaluate **XYFlow/React Flow** only if vanilla graph costs exceed benefit — document ADR if introduced.

---

## Phase 1 detail

Deliver `web/studio.html` (+ CSS/JS):

- Top: logo, project name (`/api/model/projects/active`), sim status, run/pause/stop → existing `/api/runtime/*`  
- Left: PROJECT / ENGINEERING / SIMULATION / VERIFICATION / INTEGRATION nav (context-preserving links + in-shell panels)  
- Center: live equipment map from `/api/runtime/canvas`  
- Right: selected equipment inspector (overview + signal values)  
- Bottom: events from `/api/runtime/events`  
- Landing: three CTAs — Launch Studio, Upload P&ID, Explore Sample Plant — keep dark navy aesthetic  

**Not in Phase 1:** React Flow, WebSocket, full process physics, new microservices.

---

## Mapping prior MVP → this plan

Prior Phases 0–20 + Addendum A remain the **backend/capability foundation**.  
This plan rebuilds the **workspace UX** around that foundation without replacing Runtime/Verify/Connect cores.  
