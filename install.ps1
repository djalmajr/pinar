# One-shot install: download Pinar, put the launcher in %USERPROFILE%\.pinar\bin, register hooks.
$ErrorActionPreference = "Stop"

$Repo = if ($env:PINAR_REPO) { $env:PINAR_REPO } else { "djalmajr/pinar" }
$Ref = if ($env:PINAR_REF) { $env:PINAR_REF } else { "main" }
$Prefix = if ($env:PINAR_HOME) { $env:PINAR_HOME } else { Join-Path $HOME ".pinar" }

$runtime = $null
if (Get-Command node -ErrorAction SilentlyContinue) { $runtime = "node" }
elseif (Get-Command bun -ErrorAction SilentlyContinue) { $runtime = "bun" }
else { throw "pinar: need node or bun on PATH" }

if ($Ref -eq "main" -or $Ref -eq "master") {
  $url = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"
} else {
  $url = "https://github.com/$Repo/archive/refs/tags/$Ref.zip"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("pinar-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "pinar: downloading $Repo@$Ref"
  $zip = Join-Path $tmp "pinar.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  if (-not (Test-Path (Join-Path $src.FullName "src\cli.mjs"))) {
    throw "pinar: unexpected archive layout"
  }
  & $runtime (Join-Path $src.FullName "src\cli.mjs") install
} finally {
  Remove-Item -Recurse -Force $tmp
}

$env:Path = "$(Join-Path $Prefix 'bin');$env:Path"
Write-Host "pinar: launcher $(Join-Path $Prefix 'bin\pinar.cmd')"
Write-Host "pinar: open a new terminal so PATH picks up %USERPROFILE%\.pinar\bin"
Write-Host "pinar: Chrome → Load unpacked → $(Join-Path $Prefix 'extension')"
