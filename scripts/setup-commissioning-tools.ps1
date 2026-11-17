$ErrorActionPreference='Stop'
$workspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$toolRoot=[IO.Path]::GetFullPath((Join-Path $workspace '.tmp\commissioning-tools'))
if(-not $toolRoot.StartsWith($workspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Tool directory must stay inside the workspace'}
$downloadRoot=Join-Path $toolRoot 'downloads'
New-Item -ItemType Directory -Force -Path $toolRoot,$downloadRoot | Out-Null
function Fetch-Tool([string]$Name,[string]$Url){
  $target=Join-Path $downloadRoot $Name
  if(-not (Test-Path -LiteralPath $target)){
    Write-Host "Downloading $Name"
    & curl.exe --silent --show-error --location --fail --retry 2 --output $target $Url
    if($LASTEXITCODE -ne 0){throw "Download failed: $Name"}
  }
  return $target
}
$ffmpegArchive=Fetch-Tool 'ffmpeg.zip' 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$ffmpegHash=Fetch-Tool 'ffmpeg.sha256' 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256'
$expected=[regex]::Match((Get-Content -LiteralPath $ffmpegHash -Raw),'[a-fA-F0-9]{64}').Value
if(-not $expected -or (Get-FileHash -LiteralPath $ffmpegArchive -Algorithm SHA256).Hash -ne $expected){throw 'FFmpeg checksum validation failed'}
$ffmpegDir=Join-Path $toolRoot 'ffmpeg'
if(-not (Test-Path -LiteralPath $ffmpegDir)){Expand-Archive -LiteralPath $ffmpegArchive -DestinationPath $ffmpegDir}
$ffmpegBinary=Get-ChildItem -LiteralPath $ffmpegDir -Recurse -File -Filter 'ffmpeg.exe' | Select-Object -First 1
$ffprobeBinary=Get-ChildItem -LiteralPath $ffmpegDir -Recurse -File -Filter 'ffprobe.exe' | Select-Object -First 1

$magickArchive=Fetch-Tool 'imagemagick.7z' 'https://github.com/ImageMagick/ImageMagick/releases/download/7.1.2-36/ImageMagick-7.1.2-36-portable-Q16-HDRI-x64.7z?simkit=20261117'
$magickDir=Join-Path $toolRoot 'imagemagick'
if(-not (Test-Path -LiteralPath (Join-Path $magickDir 'magick.exe'))){
  New-Item -ItemType Directory -Force -Path $magickDir | Out-Null
  & tar.exe -xf $magickArchive -C $magickDir
  if($LASTEXITCODE -ne 0){throw 'ImageMagick extraction failed'}
}
$magickBinary=Get-ChildItem -LiteralPath $magickDir -Recurse -File -Filter 'magick.exe' | Select-Object -First 1

$popplerArchive=Fetch-Tool 'poppler.zip' 'https://github.com/oschwartz10612/poppler-windows/releases/download/v26.09.0-0/Release-26.09.0-0.zip?simkit=20261117'
$popplerDir=Join-Path $toolRoot 'poppler'
if(-not (Test-Path -LiteralPath $popplerDir)){Expand-Archive -LiteralPath $popplerArchive -DestinationPath $popplerDir}
$pdfinfoBinary=Get-ChildItem -LiteralPath $popplerDir -Recurse -File -Filter 'pdfinfo.exe' | Select-Object -First 1
$pdftoppmBinary=Get-ChildItem -LiteralPath $popplerDir -Recurse -File -Filter 'pdftoppm.exe' | Select-Object -First 1

$ocrDir=Join-Path $toolRoot 'tesseract'
$ocrBinary=Join-Path $ocrDir 'tesseract.exe'
if(-not (Test-Path -LiteralPath $ocrBinary)){
  $ocrInstaller=Fetch-Tool 'tesseract-setup.exe' 'https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe?simkit=20261117'
  if(Test-Path -LiteralPath $ocrDir){throw 'Tesseract target exists without its executable; inspect before reinstalling'}
  $installer=Start-Process -FilePath $ocrInstaller -ArgumentList @('/S',"/D=$ocrDir") -WindowStyle Hidden -Wait -PassThru
  if($installer.ExitCode -ne 0){throw "Tesseract installer returned $($installer.ExitCode)"}
}
$tools=@{FFMPEG_BIN=$ffmpegBinary.FullName;FFPROBE_BIN=$ffprobeBinary.FullName;MAGICK_BIN=$magickBinary.FullName;
  PDFINFO_BIN=$pdfinfoBinary.FullName;PDFTOPPM_BIN=$pdftoppmBinary.FullName;TESSERACT_BIN=$ocrBinary}
foreach($entry in $tools.GetEnumerator()){
  if(-not $entry.Value -or -not (Test-Path -LiteralPath $entry.Value)){throw "Missing executable: $($entry.Key)"}
}
$tools | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolRoot 'tools.json') -Encoding UTF8
Write-Output 'Free commissioning verification tools installed in the private workspace tools directory.'
