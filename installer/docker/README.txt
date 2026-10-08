Docker Desktop installer (for one-click setup)
==============================================

To let users run Ironclad Runtime with zero technical steps:

1. Download Docker Desktop for Windows:
   https://www.docker.com/products/docker-desktop/

2. Put the installer in THIS folder with this exact name:
   Docker Desktop Installer.exe

3. When you package or zip the app for your users, include:
   - The whole project folder (with Run-Ironclad-Runtime.bat at the root)
   - This "docker" folder with "Docker Desktop Installer.exe" inside it

4. Tell users: "Double-click Run-Ironclad-Runtime.bat"
   - First time: they may need to right-click it and "Run as administrator"
     so Docker can install. After that, a normal double-click is enough.

Optional: Docker Desktop MSI (Enterprise)
-----------------------------------------
If you have Docker Business and use the MSI installer instead, you can add
support by editing Run-Ironclad-Runtime.bat to run:
   msiexec /i "DockerDesktop.msi" /qn /norestart
when the MSI is present in this folder. The current script looks for
"Docker Desktop Installer.exe" (the free installer).
