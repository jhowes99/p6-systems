# Fix PowerShell Execution Policy Error

You're getting this error because PowerShell scripts are disabled by default on Windows.

## Quick Fix: Use Command Prompt Instead

**Easiest solution:** Use Command Prompt (cmd.exe) instead of PowerShell:

1. Press `Win + R`
2. Type `cmd` and press Enter
3. Navigate to your project:
   ```bash
   cd C:\Work\Ironclad_Runtime
   ```
4. Run the commands:
   ```bash
   npm install
   cd server
   npm install
   cd ..
   npm run build:win
   ```

Command Prompt doesn't have this restriction!

---

## Alternative: Enable PowerShell Scripts

If you prefer PowerShell, you can enable scripts:

### Option 1: Temporary (Current Session Only)

Open PowerShell as Administrator and run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```

Then run your npm commands. This only affects the current PowerShell window.

### Option 2: Permanent (Requires Admin)

Open PowerShell as Administrator and run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

This allows scripts for your user account permanently.

### Option 3: Bypass for Single Command

You can bypass the policy for a single command:
```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
```

---

## Recommended: Use Command Prompt

For building installers, **Command Prompt is simpler** - no execution policy issues!

1. Open Command Prompt (not PowerShell)
2. Navigate: `cd C:\Work\Ironclad_Runtime`
3. Run: `npm install`
4. Continue with the build steps
