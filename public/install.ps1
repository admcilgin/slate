# Installs or updates Slate on Windows and puts the `slate` command on your PATH. In PowerShell:
#   irm https://admcilgin.github.io/slate/install.ps1 | iex
# The Windows twin of install.sh; keep the two in step. SLATE_HOME (default ~\.slate) is where Slate goes,
# SLATE_WEB the site to download from. The command goes in SLATE_HOME\bin: slate.cmd for PowerShell and cmd,
# slate for Git Bash (the shell Claude Code and other agents use on Windows). Your boards are never touched.
& {
$ErrorActionPreference = 'Stop'
function fail($m) { throw "slate: $m" } # throw, not exit: under `iex` exit would close the user's window
$web = if ($env:SLATE_WEB) { $env:SLATE_WEB } else { 'https://admcilgin.github.io/slate' }
$dir = if ($env:SLATE_HOME) { $env:SLATE_HOME } else { Join-Path $HOME '.slate' }
$enc = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::UTF8 # node prints UTF-8; a user name like Ömer would come back garbled
try {

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { fail 'needs Node.js 18 or newer: https://nodejs.org' }
$v = node -p process.versions.node
if ([int]$v.Split('.')[0] -lt 18) { fail "needs Node.js 18 or newer (found v$v)" }
foreach ($c in 'curl.exe', 'tar.exe') { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { fail "needs $c, which comes with Windows 10 (1803) and later" } }

$tgz = Join-Path ([IO.Path]::GetTempPath()) "slate-$([guid]::NewGuid()).tar.gz"
try {
  curl.exe -fsSL "$web/slate.tar.gz" -o $tgz
  if ($LASTEXITCODE) { fail "could not download $web/slate.tar.gz" }
  $list = tar.exe -tzf $tgz # read it all before touching the install
  if ($LASTEXITCODE -or $list -notcontains 'cli.js') { fail 'the download is damaged; run the installer again' }
  New-Item -ItemType Directory -Force $dir | Out-Null
  tar.exe -xzf $tgz -C $dir # the download has no data\, so boards and settings stay as they are
  if ($LASTEXITCODE) { fail "could not unpack into $dir" }
} finally { Remove-Item -Force $tgz -ErrorAction SilentlyContinue }

# The command first, so a later problem never leaves you without it. Both find cli.js from their own folder,
# so a non-ASCII user name never meets cmd's code page. `& exit /b` keeps cmd from reading slate.cmd again
# after node returns: `slate uninstall` has deleted it by then.
$bin = Join-Path $dir 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
[IO.File]::WriteAllText("$bin\slate.cmd", "@node `"%~dp0..\cli.js`" %* & exit /b`r`n")
[IO.File]::WriteAllText("$bin\slate", "#!/bin/sh`nexec node `"`$(dirname `"`$0`")/../cli.js`" `"`$@`"`n")
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
$fresh = ($user -split ';') -notcontains $bin
if ($fresh) { [Environment]::SetEnvironmentVariable('Path', ((@($user -split ';' | Where-Object { $_ }) + $bin) -join ';'), 'User') }
if (($env:Path -split ';') -notcontains $bin) { $env:Path = "$bin;$env:Path" } # this window too

# First install: boards go to ~\Slate, a folder you can see and pick in the browser (~\.slate is hidden).
# A data\ holding nothing but an untouched demo board is an earlier install that never got further.
$demo = (Get-FileHash "$dir\demo.json").Hash
$used = (Test-Path "$dir\.slate-data") -or @(Get-ChildItem "$dir\data\boards\*.json" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne 'demo.json' -or (Get-FileHash $_.FullName).Hash -ne $demo }).Count
if (-not $used) {
  $pick = Join-Path $HOME 'Slate'
  # Boards already in a folder picked on the web copy: use that one, so the browser and agents share it.
  # With no one to ask (CI, say) it is ~\Slate.
  try { $ans = Read-Host "`nAlready picked a boards folder on ${web}? Drag it here and press Enter.`nOr just press Enter for $pick" } catch { $ans = '' }
  $ans = "$ans".Trim().Trim('"', "'") # a dragged path may come quoted
  if ($ans.StartsWith('~')) { $ans = $HOME + $ans.Substring(1) }
  if ($ans) {
    if (Test-Path -PathType Container $ans) { $pick = $ans } else { Write-Host "No folder at $ans; using $pick. Change it later with: slate use <folder>" }
  }
  New-Item -ItemType Directory -Force $pick | Out-Null
  node "$dir\cli.js" use $pick | Out-Null
  if ($LASTEXITCODE) { fail "could not set up $pick" }
}
$status = node "$dir\cli.js" status
if ($LASTEXITCODE) { fail 'slate status failed; run it to see why' }
$boards = Split-Path (($status | Out-String) | ConvertFrom-Json).boardsDir

node "$dir\cli.js" install *> $null
$agents = if ($LASTEXITCODE) { 'No agent found yet: run `slate install` after installing Claude Code, Codex or Copilot.' } else { 'Your agents know about Slate now.' }

Write-Host ''
Write-Host "Slate is installed. Your boards are files in $boards."
Write-Host $agents
Write-Host ''
Write-Host "  See them   Open $web in Chrome, Edge or Brave and pick that folder,"
Write-Host '             or run `slate start` for a local copy and open the address it prints'
Write-Host '  Use them   Ask your agent: "put the login flow on my Slate board"'
Write-Host '  Commands   slate status, slate show demo, or just slate for the list'
if ($fresh) {
  Write-Host ''
  Write-Host 'slate works in this window now. Open new terminals, and restart your agent, for it to work there too.'
}

} finally { [Console]::OutputEncoding = $enc }
}
