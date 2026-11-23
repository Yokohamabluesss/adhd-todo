$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktopDirectory 'ADHD Todo.lnk'
$nodePath = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$launcherPath = Join-Path $PSScriptRoot 'launch.mjs'
$shellObject = New-Object -ComObject WScript.Shell
$shortcut = $shellObject.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and
    ($shortcut.TargetPath -ne $nodePath -or $shortcut.Arguments -ne ('"' + $launcherPath + '"'))) {
    throw "An unrelated ADHD Todo shortcut already exists on the Desktop."
}
$shortcut.TargetPath = $nodePath
$shortcut.Arguments = '"' + $launcherPath + '"'
$shortcut.WorkingDirectory = $projectDirectory
$shortcut.Description = "Open the local ADHD Todo board"
$shortcut.WindowStyle = 7
$shortcut.IconLocation = (Join-Path $PSScriptRoot 'board.ico') + ',0'
$shortcut.Save()
$savedShortcut = $shellObject.CreateShortcut($shortcutPath)
if ($savedShortcut.Arguments -ne $shortcut.Arguments) { throw "Shortcut verification failed." }
Write-Output $shortcutPath
