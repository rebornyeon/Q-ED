$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$nodeDir = "$env:USERPROFILE\.nodejs"
$zipPath = Join-Path $env:TEMP 'node.zip'

Write-Host "Downloading Node.js v22.14.0 (zip)..."
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile $zipPath -UseBasicParsing

Write-Host "Extracting..."
if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $env:USERPROFILE -Force
Rename-Item "$env:USERPROFILE\node-v22.14.0-win-x64" $nodeDir

# Add to user PATH
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -notlike "*\.nodejs*") {
    [Environment]::SetEnvironmentVariable('PATH', "$nodeDir;$userPath", 'User')
}

Write-Host "Node.js installed to $nodeDir"
& "$nodeDir\node.exe" --version
& "$nodeDir\npm.cmd" --version
