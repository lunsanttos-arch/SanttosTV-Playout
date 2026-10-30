param([switch]$SkipDependencyInstall)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'Build requires Windows x64. The master PC only needs the resulting installer.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 x64 on the BUILD computer first.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd not found on the BUILD computer.' }
$architecture = & node -p 'process.arch'
if ($LASTEXITCODE -ne 0 -or $architecture -ne 'x64') { throw 'Use Node.js x64 for the Windows x64 installer.' }
$running = @(Get-Process -Name 'SanttosTVAutomation','ndi_test','omt_sender' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw 'Close Santtos and its senders before building. No process was stopped automatically.' }
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$destination = Join-Path $root ('build\release-' + $pkg.version)
if (Test-Path $destination) { throw "Release already exists: $destination. Preserve it and increment the version before another build." }

function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE. Installer generation stopped." }
}

# Reuse only a sender that passes the real executable capability probe.
# A workstation already running the current Santtos can build without installing the SDK again.
$ndiFolder = Join-Path $root 'src\core\ndi'
$ndiZip = Join-Path $root 'build-resources\ndi-runtime-windows-x64.zip'
if ((-not (Test-Path (Join-Path $ndiFolder 'ndi_test.exe')) -or -not (Test-Path (Join-Path $ndiFolder 'Processing.NDI.Lib.x64.dll'))) -and (Test-Path $ndiZip)) {
    $expectedNdi = '9ee4732cece8049ad7f9a64d970f2b98ac5ee4f9af95a13fdaad7f9123ae3be2'
    if ((Get-FileHash $ndiZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedNdi) { throw 'Prepared NDI archive SHA-256 mismatch.' }
    $ndiStage = Join-Path ([IO.Path]::GetTempPath()) ('santtos-ndi-' + [guid]::NewGuid().ToString('N'))
    try {
        Expand-Archive -LiteralPath $ndiZip -DestinationPath $ndiStage
        foreach ($name in @('ndi_test.exe','Processing.NDI.Lib.x64.dll')) {
            $files = @(Get-ChildItem $ndiStage -Recurse -File -Filter $name)
            if ($files.Count -ne 1) { throw "Expected exactly one $name in the prepared NDI archive." }
            Copy-Item -LiteralPath $files[0].FullName -Destination (Join-Path $ndiFolder $name)
        }
    } finally { if (Test-Path $ndiStage) { Remove-Item -LiteralPath $ndiStage -Recurse -Force } }
}
& node 'src/core/ndi/ndi-capabilities.js'
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Trying to compile NDI using the SDK installed on this build computer...'
    Run-Checked 'cmd.exe' @('/d','/c','scripts\build-ndi.cmd')
    Run-Checked 'node' @('src/core/ndi/ndi-capabilities.js')
}

# Source and hash are pinned together; do not use a moving "latest" URL.
$runtime = Join-Path $root 'src\core\runtime'
$required = @('ffmpeg.exe','ffprobe.exe','manifest.json')
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $runtime $_)) })
if ($missing.Count -gt 0) {
    $url = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
    $expected = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
    $stage = Join-Path ([IO.Path]::GetTempPath()) ('santtos-media-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $stage 'media.zip'
        Write-Host 'Downloading pinned FFmpeg/FFprobe for Windows (about 110 MB)...'
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
        $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw 'Media archive SHA-256 mismatch. Nothing will be packaged.' }
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $stage 'expanded')
        $ffmpeg = @(Get-ChildItem (Join-Path $stage 'expanded') -Recurse -File -Filter 'ffmpeg.exe')
        $ffprobe = @(Get-ChildItem (Join-Path $stage 'expanded') -Recurse -File -Filter 'ffprobe.exe')
        $license = @(Get-ChildItem (Join-Path $stage 'expanded') -Recurse -File -Filter 'LICENSE*')
        if ($ffmpeg.Count -ne 1 -or $ffprobe.Count -ne 1 -or $license.Count -lt 1) { throw 'Incomplete media archive.' }
        New-Item -ItemType Directory -Force $runtime | Out-Null
        Copy-Item -LiteralPath $ffmpeg[0].FullName -Destination (Join-Path $runtime 'ffmpeg.exe')
        Copy-Item -LiteralPath $ffprobe[0].FullName -Destination (Join-Path $runtime 'ffprobe.exe')
        Copy-Item -LiteralPath $license[0].FullName -Destination (Join-Path $runtime 'LICENSE-FFMPEG.txt')
        @"
FFmpeg/FFprobe 9.0.2 essentials build from Gyan.
Binary archive: $url
Archive SHA-256: $expected
Build information and dependency/source references: https://www.gyan.dev/ffmpeg/builds/
Build project: https://github.com/GyanD/codexffmpeg
Upstream source: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
License text: LICENSE-FFMPEG.txt (copied from the binary archive).
This is an installation candidate, not a declaration of broadcast qualification.
"@ | Set-Content (Join-Path $runtime 'SOURCE-FFMPEG.txt') -Encoding UTF8
        $manifest = @{
            ffmpegSha256 = (Get-FileHash (Join-Path $runtime 'ffmpeg.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
            ffprobeSha256 = (Get-FileHash (Join-Path $runtime 'ffprobe.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
            sourceUrl = $url; archiveSha256 = $expected; version = '9.0.2'
        } | ConvertTo-Json
        # Windows PowerShell 5.1's UTF8 adds a BOM, which JSON.parse rejects.
        [IO.File]::WriteAllText((Join-Path $runtime 'manifest.json'), $manifest, (New-Object Text.UTF8Encoding($false)))
    } finally { Remove-Item -LiteralPath $stage -Recurse -Force }
}
$env:FFMPEG_BIN = Join-Path $runtime 'ffmpeg.exe'
$env:FFPROBE_BIN = Join-Path $runtime 'ffprobe.exe'
# These checks never accept missing NDI/OMT/media components.
Run-Checked 'node' @('scripts/check-native-runtime.js')
Run-Checked (Join-Path $root 'src\core\omt\omt_sender.exe') @('--runtime-probe')
if (-not $SkipDependencyInstall) { Run-Checked 'npm.cmd' @('ci','--include=dev') }
Run-Checked 'npm.cmd' @('run','test:frontend')
Run-Checked 'npm.cmd' @('run','test:release-kit')
Run-Checked 'npm.cmd' @('run','test:media-runtime')
Run-Checked 'npm.cmd' @('run','test:audio-leveling')
Run-Checked 'npm.cmd' @('run','test:transports')
# Calling electron-builder directly deliberately avoids recompiling an already
# validated NDI sender through npm's prebuild hook. Native checks above remain mandatory.
Run-Checked 'npm.cmd' @('exec','--','electron-builder','--win','--x64','--publish','never')
Run-Checked 'node' @('scripts/create-release-kit.js')
Write-Host "Installer and SHA-256 inventory: $destination"
