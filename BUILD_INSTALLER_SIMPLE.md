# Build Windows Installer - Simple Method (Inno Setup)

## Quick Start

### Step 1: Install Inno Setup

Download and install from: https://jrsoftware.org/isdl.php

### Step 2: Build the Installer

1. **Open Command Prompt** (not PowerShell)
2. Navigate to installer directory:
   ```bash
   cd C:\Work\Ironclad_Runtime\installer
   ```
3. Run the build script:
   ```bash
   build-installer.bat
   ```

### Step 3: Find Your Installer

The installer will be in:
```
C:\Work\Ironclad_Runtime\dist\AxiomControl-Setup-1.0.0.exe
```

## What This Creates

- ✅ Professional Windows installer (EXE)
- ✅ Desktop shortcut
- ✅ Start Menu entry
- ✅ Uninstaller
- ✅ Checks for Node.js

## What Users Need

- Windows 10/11
- Node.js v18+ installed (installer will warn if missing)

## Manual Build (Alternative)

If the batch file doesn't work:

1. Open **Inno Setup Compiler**
2. Open `installer/axiom-control.iss`
3. Click **Build** → **Compile** (or press F9)
4. Installer appears in `dist/` folder

## That's It!

The installer is ready to distribute. Users just double-click and install!
