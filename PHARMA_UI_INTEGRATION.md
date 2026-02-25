# Pharma Mode UI Integration Guide

## Files Created

1. **`web/pharma_compliance.js`** - Main compliance UI components
   - Compliance Status Strip (top bar)
   - Change Request Drawer
   - Signature Modal
   - Compare Drawer
   - Export Binder Modal
   - Audit Log Modal

2. **`web/pharma_compliance.css`** - Styles for all compliance UI components

3. **`web/pharma_sidebar.js`** - Compliance sidebar component
   - Traceability Modal
   - Approvals Modal
   - Validation Pack Modal
   - Policies Modal

4. **`web/pharma_init.js`** - Initialization script that wires everything together

## Integration Steps

### Step 1: Add to HTML Pages

Add these lines to any page where you want Pharma Mode UI (e.g., `panel_builder.html`, `monitor.html`):

```html
<head>
  <!-- ... existing stylesheets ... -->
  <link rel="stylesheet" href="pharma_compliance.css" />
</head>
<body>
  <!-- ... existing content ... -->
  
  <!-- Add before closing </body> tag -->
  <script src="pharma_init.js"></script>
</body>
```

### Step 2: Add Edit Guards

Add `data-pharma-guard` attribute to forms/buttons that should be protected:

```html
<form data-pharma-guard>
  <!-- form content -->
</form>

<button data-pharma-guard>Edit</button>
```

### Step 3: Test

1. Open a page (e.g., `/panel_builder.html`)
2. The Compliance Status Strip should appear at the top
3. Toggle "Pharma Mode" ON
4. The sidebar should show a "Compliance" section
5. Try editing - should be blocked if IN_REVIEW or RELEASED

## Components Overview

### Compliance Status Strip
- **Location**: Top of page (inserted before `.page-header`)
- **Shows**: Pharma Mode toggle, State badge, Release version, Active CR
- **Actions**: Change Request, Compare, Submit for Review, Export Binder, Audit Log

### Compliance Sidebar
- **Location**: Left sidebar (added to `aside.left` or `.left-sidebar`)
- **Sections**: Traceability, Approvals, Audit Trail, Validation Pack, Policies

### Modals/Drawers
- **Change Request Drawer**: Opens from status strip or when editing released project
- **Signature Modal**: Opens from Approvals sidebar link
- **Compare Drawer**: Compare two releases
- **Export Binder Modal**: Generate validation binder PDF
- **Audit Log Modal**: View audit trail
- **Traceability Modal**: View traceability matrix
- **Approvals Modal**: View/sign approval steps
- **Policies Modal**: Configure pharma policies

## API Integration

All components use the `/api/pharma` endpoints:
- `GET /api/pharma/projects/:id/compliance/summary` - Get current state
- `PATCH /api/pharma/projects/:id/pharma-mode` - Toggle pharma mode
- `POST /api/pharma/projects/:id/change-requests` - Create CR
- `POST /api/pharma/projects/:id/sign` - Sign approval
- etc.

## Edit Guards

The `pharma_init.js` script automatically:
1. Checks project state before allowing edits
2. Shows toast notifications for blocked actions
3. Prompts to open CR when editing released projects
4. Blocks edits when IN_REVIEW (if policy enabled)

## Customization

### Change Project ID
Edit `pharma_init.js`:
```javascript
const projectId = "your-project-id"; // Instead of "default"
```

### Customize Status Strip Position
Edit `pharma_compliance.js`:
```javascript
const pageHeader = document.querySelector(".your-selector");
```

### Add Custom Modals
Follow the pattern in `pharma_compliance.js`:
1. Create modal HTML
2. Add event handlers
3. Export function to `window`

## Next Steps

1. ✅ Status Strip - Complete
2. ✅ Sidebar - Complete
3. ✅ Modals/Drawers - Complete
4. ⏳ Canvas chips (REQ/TC) - TODO
5. ⏳ Edit guard integration - Partial (needs more endpoints protected)
6. ⏳ Test evidence capture - TODO
