param([string]$Python = 'py')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    npm.cmd run build:windows
    if ($LASTEXITCODE) { throw 'The shared frontend build failed.' }
    $icon = (Resolve-Path -LiteralPath 'scripts/board.ico').Path
    & $Python -m PyInstaller --noconfirm --onefile --windowed --name 'ADHD Todo' --icon $icon --distpath windows/out --workpath windows/.build/work --specpath windows/.build --add-data "$PSScriptRoot/.build/ui;ui" --add-data "$PSScriptRoot/.build/schema.sql;." windows/app.py
    if ($LASTEXITCODE) { throw 'Packaging failed.' }
    Write-Output (Resolve-Path -LiteralPath 'windows/out/ADHD Todo.exe')
} finally {
    Pop-Location
}
