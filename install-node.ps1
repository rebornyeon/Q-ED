$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$outPath = Join-Path $env:TEMP 'node-install.msi'
Write-Host "Downloading Node.js v22.14.0..."
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile $outPath -UseBasicParsing
Write-Host "Installing..."
Start-Process msiexec.exe -ArgumentList '/i', $outPath, '/quiet', '/norestart' -Wait -NoNewWindow
Write-Host "Done"
