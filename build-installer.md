# Building Windows Installer for Axiom Control

## Option 1: Electron + electron-builder (Recommended)

This creates a desktop application wrapper with MSI/EXE installers.

### Prerequisites

1. Install Node.js (v18 or higher)
2. Install dependencies:
   ```bash
   npm install
   cd server
   npm install
   cd ..
   ```

### Build Steps

1. **Install Electron dependencies:**
   ```bash
   npm install
   ```

2. **Build the installer:**
   ```bash
   # Build NSIS installer (EXE)
   npm run build:win
   
   # Build MSI installer
   npm run build:win:msi
   
   # Build portable version (no installer)
   npm run build:win:portable
   ```

3. **Output:**
   - Installers will be in the `dist/` folder
   - `Axiom Control Setup x.x.x.exe` (NSIS installer)
   - `Axiom Control x.x.x.msi` (MSI installer)

### What the installer includes:

- ✅ Bundled Node.js runtime
- ✅ All application files
- ✅ Desktop shortcut
- ✅ Start menu entry
- ✅ Uninstaller
- ✅ Automatic updates (if configured)

---

## Option 2: Inno Setup (Traditional Installer)

For a more traditional Windows installer experience.

### Prerequisites

1. Download and install [Inno Setup](https://jrsoftware.org/isdl.php)
2. Install Node.js

### Setup

1. **Create installer script:** See `installer/axiom-control.iss`
2. **Build:**
   - Open `installer/axiom-control.iss` in Inno Setup Compiler
   - Click "Build" → "Compile"

### What it includes:

- ✅ Checks for Node.js installation
- ✅ Installs application files
- ✅ Creates Windows service (optional)
- ✅ Desktop and Start Menu shortcuts
- ✅ Uninstaller

---

## Option 3: WiX Toolset (MSI Only)

For enterprise deployment with Group Policy support.

### Prerequisites

1. Install [WiX Toolset](https://wixtoolset.org/)
2. Install Node.js

### Build

1. Open `installer/axiom-control.wxs` in WiX
2. Build the MSI package

---

## Testing the Installer

1. **Test on clean Windows VM:**
   - Windows 10/11
   - No Node.js installed
   - Fresh install

2. **Verify:**
   - Application launches
   - Server starts automatically
   - Browser opens to localhost:3000
   - All features work

---

## Distribution

- **EXE installer:** Best for end users (easiest)
- **MSI installer:** Best for enterprise/IT deployment
- **Portable:** Best for USB drives or no-install scenarios
