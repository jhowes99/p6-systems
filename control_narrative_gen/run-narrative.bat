@echo off
REM Generate control narratives from Logic/functional diagrams PDF.
REM Usage: run-narrative.bat [path-to-your-logic.pdf]
REM   If you pass a path, that file is copied to inputs/logic_diagrams.pdf and used.
REM   If you don't pass a path, uses inputs/logic_diagrams.pdf if it exists.

cd /d "%~dp0"
set "LOGIC_PDF=%~1"
if not defined LOGIC_PDF set "LOGIC_PDF=inputs\logic_diagrams.pdf"

if "%~1" neq "" (
  if not exist "%~1" (
    echo File not found: %~1
    pause
    exit /b 1
  )
  echo Copying %~1 to inputs\logic_diagrams.pdf ...
  copy /y "%~1" "inputs\logic_diagrams.pdf" >nul
  if errorlevel 1 (
    echo Failed to copy file.
    pause
    exit /b 1
  )
)

if not exist "inputs\logic_diagrams.pdf" (
  echo No logic PDF found. Either:
  echo   1. Run: run-narrative.bat "C:\path\to\your\logic.pdf"
  echo   2. Or copy your PDF to inputs\logic_diagrams.pdf and run run-narrative.bat
  pause
  exit /b 1
)

echo.
echo Generating control narrative...
echo.
python scripts/generate.py --logic inputs/logic_diagrams.pdf --out exports --project "Combustion Control System, Fully Metered" --customer "TotalEnergies Port Arthur, TX."
if errorlevel 1 (
  echo.
  echo Generation failed. Check that Python is installed and you ran: pip install -r requirements.txt
  pause
  exit /b 1
)

echo.
echo Done. Outputs are in: %~dp0exports
echo   - control_narrative.md, .docx, .pdf
echo   - tag_dictionary.csv, cause_effect.csv
echo   - diagrams\
echo.
start "" "%~dp0exports"
pause
