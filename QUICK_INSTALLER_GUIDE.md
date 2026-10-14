# Quick Guide: Creating Windows Installer for P6 Systems

## 🚀 Recommended: Electron Builder (Easiest)

This method creates a professional installer that bundles everything, including Node.js.

### Where to Run Commands

**All commands must be run from the project root directory:**
```
C:\Work\Ironclad_Runtime\
```

**Important:** Use **Command Prompt (cmd.exe)**, not PowerShell, to avoid execution policy errors.

To open Command Prompt:
- Press `Win + R`, type `cmd`, press Enter
- OR search "Command Prompt" in Start Menu

Navigate there:
```bash
cd C:\Work\Ironclad_Runtime
```

**If you get a PowerShell execution policy error:** See `FIX_POWERSHELL.md` or just use Command Prompt instead!

### Step 1: Install Dependencies

```bash
# From project root (C:\Work\Ironclad_Runtime)
npm install
cd server
npm install
cd ..
```

### Step 2: Build Installer

```bash
# Build EXE installer (recommended)
npm run build:win

# OR build MSI installer (for enterprise)
npm run build:win:msi
```

### Step 3: Find Your Installer

Look in the `dist/` folder:
- ✅ `P6 Systems Setup 1.0.0.exe` - Ready to distribute!

### What Users Get

- ✅ One-click installer
- ✅ Desktop shortcut
- ✅ Start Menu entry
- ✅ Automatic uninstaller
- ✅ Everything bundled (no Node.js needed)

---

## 📦 Alternative: Simple Batch Installer

If you don't want to use Electron, use the simple batch installer:

1. Run `installer/simple-installer.bat`
2. Creates a portable installation in user's folder
3. Creates desktop shortcut
4. **Note:** Requires Node.js to be pre-installed

---

## 🎯 Alternative: Portable ZIP

Create a portable version:

1. Run `installer/create-portable.bat`
2. Creates `P6Systems-Portable-1.0.0.zip`
3. Users extract and run `Start.bat`
4. **Note:** Requires Node.js to be pre-installed

---

## 📋 Requirements

### For Building:
- Node.js v18+
- npm
- Windows 10/11

### For Users (Electron version):
- Windows 10/11 (64-bit)
- **Nothing else!** (Node.js is bundled)

### For Users (Other versions):
- Windows 10/11
- Node.js v18+ installed

---

## 🧪 Testing

1. Test installer on clean Windows VM
2. Verify application launches
3. Check all features work
4. Test uninstaller

---

## 💡 Tips

- **For end users:** Use EXE installer (Electron Builder)
- **For IT/enterprise:** Use MSI installer
- **For USB drives:** Use portable ZIP
- **Icon:** Place `build/icon.ico` for custom icon
