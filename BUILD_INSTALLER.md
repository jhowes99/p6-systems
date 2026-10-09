# Building Windows Installer for P6 Systems

## Quick Start (Electron Builder - Recommended)

This is the easiest method and creates a professional installer with bundled Node.js.

### Step 1: Install Dependencies

```bash
# Install root dependencies (Electron)
npm install

# Install server dependencies
cd server
npm install
cd ..
```

### Step 2: Icon Setup

The application icon has been set up at `build/icon.png`. 
- electron-builder will automatically convert PNG to ICO for Windows installers
- The icon will appear in:
  - Installer window
  - Desktop shortcut
  - Start Menu entry
  - Taskbar when running

### Step 3: Build Installer

```bash
# Build NSIS installer (EXE) - Recommended for end users
npm run build:win

# Build MSI installer - Recommended for enterprise
npm run build:win:msi

# Build portable version (no installer, just a folder)
npm run build:win:portable
```

### Step 4: Find Your Installer

Installers will be in the `dist/` folder:
- `P6 Systems Setup 1.0.0.exe` - NSIS installer (recommended)
- `P6 Systems 1.0.0.msi` - MSI installer (for IT deployment)
- `P6 Systems 1.0.0.exe` - Portable version

## What Users Get

When users run the installer:
1. ✅ Application installs to `C:\Program Files\P6 Systems`
2. ✅ Desktop shortcut created
3. ✅ Start Menu entry added
4. ✅ Can uninstall via Windows Settings
5. ✅ Application launches automatically after install

## Alternative: Inno Setup

If you prefer a more traditional installer:

1. Install [Inno Setup](https://jrsoftware.org/isdl.php)
2. Open `installer/axiom-control.iss`
3. Click Build → Compile
4. Installer will be in `dist/` folder

**Note:** Inno Setup installer requires Node.js to be pre-installed on the user's machine.

## Testing

1. Test on a clean Windows VM (Windows 10/11)
2. Install the generated installer
3. Verify:
   - Application launches
   - Opens to http://localhost:3000
   - All features work
   - Can uninstall cleanly

## Troubleshooting

### "Node.js not found" error
- Electron builder bundles Node.js automatically
- If using Inno Setup, ensure Node.js is installed first

### Installer is too large
- Electron bundles Node.js (~100MB)
- This is normal for a self-contained application

### Application won't start
- Check Windows Firewall isn't blocking port 3000
- Check antivirus isn't blocking the application
- Check Event Viewer for errors

## Distribution

- **EXE (NSIS):** Best for end users - simple double-click install
- **MSI:** Best for IT/enterprise - supports Group Policy deployment
- **Portable:** Best for USB drives or no-install scenarios
