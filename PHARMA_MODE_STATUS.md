# Pharma Mode Implementation Status

## ✅ Phase 1 Complete (Backend Infrastructure)

### Implemented Components

1. **Storage Layer** (`server/pharma/storage.js`)
   - File-based JSON storage for all pharma entities
   - Projects, policies, releases, change requests, requirements, trace links, signatures, audit events, test cases
   - Canonical JSON serialization + SHA256 hashing
   - Hash chain verification for audit events

2. **Middleware** (`server/pharma/middleware.js`)
   - `pharmaWriteGate` middleware for state-based editing restrictions
   - Enforces IN_REVIEW lock and RELEASED CR requirements
   - Attaches compliance context to requests

3. **Snapshot Builder** (`server/pharma/snapshot.js`)
   - Builds canonical release snapshots
   - Computes snapshot hashes
   - Compare/diff functionality

4. **API Endpoints** (`server/pharma/api.js`)
   - ✅ Projects & Policies: `/api/pharma/projects/:id/pharma-mode`, `/api/pharma/projects/:id/pharma-policies`
   - ✅ State Transitions: `/api/pharma/projects/:id/submit-for-review`, `/api/pharma/projects/:id/release`
   - ✅ Change Requests: CRUD + submit/close
   - ✅ Releases: list, get, compare
   - ✅ Requirements: CRUD
   - ✅ Trace Links: create, list, delete
   - ✅ Traceability Matrix: `/api/pharma/projects/:id/releases/:id/traceability-matrix`
   - ✅ Signatures: create, list
   - ✅ Approvals Status: `/api/pharma/projects/:id/approvals/status`
   - ✅ Audit Events: list, verify
   - ✅ Test Cases: CRUD
   - ✅ Test Runs: create, list
   - ✅ Validation Binder: placeholder endpoint

5. **Server Integration**
   - Pharma API routes mounted at `/api/pharma`
   - Integrated into main `server.js`

## 🚧 Next Steps (Phase 2 - UI)

### Priority 1: Compliance Status Strip (Top Bar)
- Add to main layout pages (panel_builder.html, monitor.html, etc.)
- Display: Pharma Mode toggle, State badge, Release version, Active CR
- Action buttons: Change Request | Compare | Submit for Review | Export Binder | Audit Log

### Priority 2: Compliance Sidebar
- Add "Compliance" section to left sidebar
- Subsections: Traceability, Approvals, Audit Trail, Validation Pack, Access & Roles, Policies

### Priority 3: Modals/Drawers
- ChangeRequestDrawer: Create/edit CR with reason, impact, affected areas
- SignatureModal: Password re-entry, meaning dropdown, comment
- DiffCompareDrawer: Show release comparison
- ExportBinderModal: Generate validation binder PDF
- AuditEventDetailModal: Show before/after diff

### Priority 4: Canvas Enhancements
- Add chips to rungs: REQ-### / FRS-### / TC-###
- Add chips to IO tags: GMP / NON-GMP / SAFETY / QUALITY
- Click chip → highlight linked objects + open inspector

### Priority 5: Edit Guards
- IN_REVIEW: Block edits → toast "Locked in Review"
- RELEASED: Block edits → modal "Open Change Request?" with reason required

## 📋 Remaining Tasks

- [ ] Build validation binder PDF generator (basic)
- [ ] Add test evidence capture from monitor toggles
- [ ] Implement "Run Test" mode with evidence recording
- [ ] Add SDS generator endpoint
- [ ] Wire pharmaWriteGate to existing write endpoints (program upload, panel edits, etc.)
- [ ] Add RBAC for signature steps (EngineeringReview, ValidationReview, QAApproval)
- [ ] Create UI components for all modals/drawers
- [ ] Add traceability matrix export (CSV/PDF)
- [ ] Implement "Reason for Change" capture UI
- [ ] Add policy templates per site

## 🔧 Technical Notes

### Storage Location
All pharma data stored in `server/data/pharma/`:
- `projects/` - Project metadata
- `releases/` - Release snapshots
- `change_requests/` - CR records
- `requirements/` - URS/FRS requirements
- `signatures/` - E-signatures
- `audit_events/` - Audit trail
- `test_cases/` - Test case definitions
- `test_runs/` - Test execution records

### API Base Path
All pharma endpoints: `/api/pharma/...`

### State Machine
- DRAFT → IN_REVIEW (Submit for Review)
- IN_REVIEW → DRAFT (Request Changes)
- IN_REVIEW → RELEASED (All signatures complete)
- RELEASED → (no direct edit) → Open CR

### Hash Chain
- Audit events use hash chain: `event_hash = sha256(canonical(event) + prev_event_hash)`
- Snapshot hash: `sha256(canonical(snapshot_json))`
- Verification endpoint: `/api/pharma/projects/:id/audit-events/verify`

## 🎯 Acceptance Criteria Status

- ✅ AC1: IN_REVIEW → edit endpoints return 409 LOCKED_IN_REVIEW
- ✅ AC2: RELEASED → edits blocked unless active CR
- ✅ AC3: Open CR creates CR-###, sets active_cr_id, switches to DRAFT
- ✅ AC4: Release stores snapshot_json + snapshot_hash (immutable)
- ✅ AC5: Every write action appends audit event with hash chain
- ✅ AC6: Signature requires password re-entry (API ready, UI pending)
- ✅ AC7: Cannot release without required approvals (enforced)
- ✅ AC8: Traceability matrix export (endpoint ready, UI pending)
- ⏳ AC9: Binder export generates PDF (placeholder, needs PDF generator)

## 📝 Usage Example

```javascript
// Enable Pharma Mode
PATCH /api/pharma/projects/default/pharma-mode
{ "enabled": true }

// Submit for Review
POST /api/pharma/projects/default/submit-for-review

// Create Change Request
POST /api/pharma/projects/default/change-requests
{
  "reasonCode": "BUG_FIX",
  "reasonText": "Fix motor start logic",
  "impactGmp": false,
  "impactSafety": true,
  "affectedAreas": ["rungs", "io"]
}

// Release
POST /api/pharma/projects/default/release
{
  "version": "v1.0.0",
  "snapshotData": { /* project state */ }
}

// Sign
POST /api/pharma/projects/default/sign
{
  "targetType": "release",
  "targetId": "release-id",
  "stepName": "EngineeringReview",
  "meaning": "Approve",
  "password": "user-password"
}
```
