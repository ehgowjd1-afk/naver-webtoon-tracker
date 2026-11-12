# 폰 화면 캡처(PNG)에서 여러 칸을 잘라 JPEG로 저장 — collect_series_app.js가 부름
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File crop.ps1 -In shot.png -Jobs jobs.json
# jobs.json = [{x,y,w,h,s(배율),out}]
param([string]$In, [string]$Jobs)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($In)
$list = Get-Content $Jobs -Raw -Encoding UTF8 | ConvertFrom-Json
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]78)
foreach ($j in @($list)) {
  $w = [int]([math]::Round($j.w * $j.s)); $h = [int]([math]::Round($j.h * $j.s))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), (New-Object System.Drawing.Rectangle $j.x, $j.y, $j.w, $j.h), [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save($j.out, $codec, $ep)
  $g.Dispose(); $bmp.Dispose()
}
$img.Dispose()
