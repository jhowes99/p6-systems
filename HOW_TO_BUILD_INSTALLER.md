# How to Build the Windows Installer

## Where to Run Commands

**Run all commands from the project root directory:**
```
C:\Work\Ironclad_Runtime\
```

This is the folder that contains:
- `package.json` (the one we just created)
- `server/` folder
- `web/` folder
- `electron/` folder
- `build/` folder

## Step-by-Step Instructions

### 1. Open Command Prompt (Recommended)

**Important:** Use **Command Prompt (cmd.exe)**, not PowerShell, to avoid execution policy issues.

To open Command Prompt:
- Press `Win + R`
- Type `cmd` and press Enter
- OR search for "Command Prompt" in Start Menu

Navigate to your project:

```bash
cd C:\Work\Ironclad_Runtime
```

**Note:** If you must use PowerShell and get an execution policy error, see `FIX_POWERSHELL.md` for solutions.

### 2. Install Root Dependencies (Electron)

```bash
npm install
```

This installs:
- Electron (desktop app framework)
- electron-builder (installer builder)

**Expected output:** Creates `node_modules/` folder in the root directory

### 3. Install Server Dependencies

```bash
cd server
npm install
cd ..
```

This installs the Node.js server dependencies (Express, etc.)

**Expected output:** Creates `server/node_modules/` folder

### 4. Build the Installer

```bash
npm run build:win
```

This will:
- Package the application
- Create the installer
- Take several minutes (first time is slower)

**Expected output:** Creates `dist/` folder with:
- `P6 Systems Setup 1.0.0.exe` (NSIS installer)
- `P6 Systems 1.0.0.msi` (MSI installer)

## Quick Copy-Paste Commands

Copy and paste these commands one at a time in Command Prompt or PowerShell:

```bash
cd C:\Work\Ironclad_Runtime
npm install
cd server
npm install
cd ..
npm run build:win
```

## Troubleshooting

### "npm is not recognized"
- Install Node.js from https://nodejs.org/
- Restart your terminal after installing

### "Cannot find module"
- Make sure you're in the project root: `C:\Work\Ironclad_Runtime`
- Run `npm install` again

### Build takes a long time
- This is normal! First build downloads Electron (~200MB)
- Subsequent builds are much faster

### Build fails
- Check you have Node.js v18 or higher: `node --version`
- Make sure all dependencies installed: `npm install` in both root and server folders

## Where is the Installer?

After building, find your installer in:
```
C:\Work\Ironclad_Runtime\dist\
```

Look for:
- `P6 Systems Setup 1.0.0.exe` ← **This is what you distribute!**
