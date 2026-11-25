$tempDir = "temp_gradle_wrapper"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null
New-Item -ItemType File -Path (Join-Path $tempDir "settings.gradle") -Force | Out-Null
Push-Location $tempDir
& "C:\Users\Hp\.gradle\wrapper\dists\gradle-8.13-bin\5xuhj0ry160q40clulazy9h7d\gradle-8.13\bin\gradle.bat" wrapper --gradle-version 8.13 --no-daemon
Pop-Location
Copy-Item (Join-Path $tempDir "gradlew") "android\" -Force
Copy-Item (Join-Path $tempDir "gradlew.bat") "android\" -Force
Copy-Item (Join-Path $tempDir "gradle") "android\" -Recurse -Force
Remove-Item $tempDir -Recurse -Force
Get-ChildItem "android\gradle\wrapper"
