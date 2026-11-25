Add-Type -AssemblyName System.Drawing
$srcPath = "public\MJ NEW LOGO.jpg"
if (-not (Test-Path $srcPath)) {
    $srcPath = "public\favicon.png"
}
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $srcPath))

$resDir = "android\app\src\main\res"
$sizes = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

foreach ($folder in $sizes.Keys) {
    $dir = Join-Path $resDir $folder
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $dim = $sizes[$folder]
    
    $square = New-Object System.Drawing.Bitmap $dim, $dim
    $g = [System.Drawing.Graphics]::FromImage($square)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($src, 0, 0, $dim, $dim)
    $g.Dispose()
    
    $square.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $square.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $square.Dispose()
}

# Play Store 512x512 icon
$playStoreBmp = New-Object System.Drawing.Bitmap 512, 512
$gPlay = [System.Drawing.Graphics]::FromImage($playStoreBmp)
$gPlay.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gPlay.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$gPlay.DrawImage($src, 0, 0, 512, 512)
$gPlay.Dispose()
$playStoreBmp.Save("android\app\playstore-icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$playStoreBmp.Dispose()

$src.Dispose()
Write-Output "All launcher icons and Play Store 512x512 icon generated successfully."
