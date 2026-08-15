# Pinar One-Shot Native Windows Installer
# Downloads pre-compiled pinar.exe to %USERPROFILE%\.pinar\bin\pinar.exe and registers AI hooks.
$ErrorActionPreference = "Stop"

$Prefix = if ($env:PINAR_HOME) { $env:PINAR_HOME } else { Join-Path $HOME ".pinar" }
$BinDir = Join-Path $Prefix "bin"
$ShotsDir = Join-Path $Prefix "shots"
$BaseUrl = if ($env:PINAR_BASE_URL) { $env:PINAR_BASE_URL } else { "https://pinar.dev" }

if (-not (Test-Path $BinDir)) {
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}
if (-not (Test-Path $ShotsDir)) {
  New-Item -ItemType Directory -Path $ShotsDir -Force | Out-Null
}

$TargetBinary = "pinar-windows-x64.exe"
$DestExe = Join-Path $BinDir "pinar.exe"
$DestCmd = Join-Path $BinDir "pinar.cmd"

Write-Host "⚡ Downloading Pinar standalone binary for Windows..."
$TargetUrl = "$BaseUrl/bin/$TargetBinary"

try {
  Invoke-WebRequest -Uri $TargetUrl -OutFile $DestExe -UseBasicParsing
} catch {
  $Repo = if ($env:PINAR_REPO) { $env:PINAR_REPO } else { "djalmajr/pinar" }
  $Ref = if ($env:PINAR_REF) { $env:PINAR_REF } else { "v0.1.1" }
  $GithubUrl = "https://github.com/$Repo/releases/download/$Ref/$TargetBinary"
  Write-Host "ℹ️ Fetching from $GithubUrl..."
  Invoke-WebRequest -Uri $GithubUrl -OutFile $DestExe -UseBasicParsing
}

# Create wrapper cmd if needed
"@echo off`r`n`"%~dp0pinar.exe`" %*" | Out-File -FilePath $DestCmd -Encoding ascii

# Register AI agent hooks
& $DestExe install-hooks

# Add to User PATH
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
}

$env:Path = "$BinDir;$env:Path"
Write-Host "✅ Pinar standalone binary installed at $DestExe"
Write-Host "🎉 Visual Annotations ready for AI Agents!"
