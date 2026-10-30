@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows-installer.ps1"
if errorlevel 1 (
    echo.
    echo O instalador NAO foi gerado. Veja o erro acima.
    pause
    exit /b 1
)
echo.
echo Copie o instalador da pasta informada para o PC do master.
pause
