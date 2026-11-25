Add-Type -AssemblyName System.Drawing
$srcPath = "public\MJ NEW LOGO.jpg"
if (-not (Test-Path $srcPath)) { $srcPath = "public\favicon.png" }
$logo = [System.Drawing.Bitmap]::FromFile((Resolve-Path $srcPath))

$width = 1024
$height = 500
$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

# Background: dark slate #151A24
$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#151A24"))
$g.FillRectangle($bgBrush, 0, 0, $width, $height)

# Red accent line on left / top
$accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#D62828"))
$g.FillRectangle($accentBrush, 0, 0, $width, 8)

# Draw Logo centered vertically on the left/center
$logoSize = 340
$logoX = 80
$logoY = [int](($height - $logoSize) / 2)
$g.DrawImage($logo, $logoX, $logoY, $logoSize, $logoSize)

# Draw Title and Tagline on the right
$titleFont = New-Object System.Drawing.Font ("Arial", 46, [System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font ("Arial", 22, [System.Drawing.FontStyle]::Regular)
$tagFont = New-Object System.Drawing.Font ("Arial", 16, [System.Drawing.FontStyle]::Italic)

$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#FFFFFF"))
$mutedBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#CBD5E1"))
$redBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#D62828"))

$textX = 460
$g.DrawString("MJ AUTOS", $titleFont, $whiteBrush, $textX, 130)
$g.DrawString("POS & Stock Management", $subFont, $redBrush, $textX, 220)
$g.DrawString("Fast Billing - Inventory - Thermal Receipts", $tagFont, $mutedBrush, $textX, 275)

$g.Dispose()
$logo.Dispose()
$bgBrush.Dispose()
$accentBrush.Dispose()
$whiteBrush.Dispose()
$mutedBrush.Dispose()
$redBrush.Dispose()
$titleFont.Dispose()
$subFont.Dispose()
$tagFont.Dispose()

$outputPath = "android\app\playstore-feature-graphic-1024x500.png"
$bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "1024x500 Feature Graphic generated successfully at $outputPath"
