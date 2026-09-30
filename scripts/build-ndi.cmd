@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not defined NDI_SDK_DIR set "NDI_SDK_DIR=C:\Program Files\NDI\NDI 6 SDK"
if not exist "%NDI_SDK_DIR%\Include\Processing.NDI.Lib.h" (
    echo ERRO: NDI SDK nao encontrado em "%NDI_SDK_DIR%".
    echo Instale o SDK NDI x64 ou defina NDI_SDK_DIR antes deste comando.
    exit /b 1
)
where cl.exe >nul 2>&1
if errorlevel 1 (
    set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
    if exist "%VSWHERE%" (
        for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
            set "VSINSTALL=%%I"
        )
    )
    if defined VSINSTALL if exist "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" (
        echo Carregando ambiente MSVC x64 automaticamente...
        call "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul
    )
)

where cl.exe >nul 2>&1
if errorlevel 1 (
    echo ERRO: compilador C++ MSVC x64 nao encontrado.
    echo Instale o Visual Studio 2022 Build Tools com "Desktop development with C++".
    echo Depois execute novamente este comando.
    exit /b 1
)
if not exist "%NDI_SDK_DIR%\Lib\x64\Processing.NDI.Lib.x64.lib" (
    echo ERRO: arquivo .lib do NDI x64 ausente.
    exit /b 1
)

if exist "src\core\ndi\ndi_test.exe" (
    echo Verificando se o sender atual esta rodando...
    tasklist /FI "IMAGENAME eq ndi_test.exe" 2>nul | find /I "ndi_test.exe" >nul
    if not errorlevel 1 (
        echo ERRO: feche Santtos TV e todas as instancias ndi_test.exe antes de compilar.
        exit /b 1
    )
)

cl /nologo /std:c++17 /EHsc /O2 /MT /D NOMINMAX /I "%NDI_SDK_DIR%\Include" ^
  /Fe:"src\core\ndi\ndi_test.exe" "src\core\ndi\ndi_test.cpp" ^
  /link /LIBPATH:"%NDI_SDK_DIR%\Lib\x64" Processing.NDI.Lib.x64.lib
if errorlevel 1 (
    echo FALHOU: sender NDI nao compilado.
    exit /b 1
)

set "NDI_DLL="
if exist "%NDI_SDK_DIR%\Bin\x64\Processing.NDI.Lib.x64.dll" (
    set "NDI_DLL=%NDI_SDK_DIR%\Bin\x64\Processing.NDI.Lib.x64.dll"
)
if not defined NDI_DLL if exist "%NDI_SDK_DIR%\Lib\x64\Processing.NDI.Lib.x64.dll" (
    set "NDI_DLL=%NDI_SDK_DIR%\Lib\x64\Processing.NDI.Lib.x64.dll"
)
if not defined NDI_DLL (
    echo ERRO: runtime NDI ausente do SDK. Instale o NDI Runtime oficial.
    exit /b 1
)
copy /Y "%NDI_DLL%" "src\core\ndi\Processing.NDI.Lib.x64.dll" >nul
if errorlevel 1 exit /b 1
node scripts\check-ndi-audio.js
if errorlevel 1 exit /b 1
echo Sender NDI atualizado. Agora: npm run dev:ndi-test
exit /b 0
