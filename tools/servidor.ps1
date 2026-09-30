<#
  Mini servidor local para abrir o Human Heart no navegador, sem instalar nada.
  (Mesmo servidor do projeto Black-Hole, com os tipos de arquivo do modelo 3D.)

  Os módulos JavaScript (ES Modules) e o modelo 3D (.glb) não carregam quando
  o index.html é aberto direto do disco (file://). Este script serve a pasta do
  projeto em http://localhost:8000 e abre o projeto.

  Placa de vídeo: em notebooks com duas placas (ex.: Intel + NVIDIA RTX) o
  Windows costuma rodar o navegador na mais fraca. Por isso o projeto abre numa
  janela própria do Chrome (ou Edge), iniciada com --force-high-performance-gpu,
  e o script oferece ativar a preferência "Alto desempenho" do Windows para
  esse navegador (o mesmo que Configurações > Sistema > Tela > Elementos
  gráficos; pode ser desfeito por lá).

  Uso: dê dois cliques em iniciar.bat
   ou: powershell -ExecutionPolicy Bypass -File tools\servidor.ps1 [-Port 8000] [-NoBrowser] [-DefaultBrowser]

  -DefaultBrowser  abre no navegador padrão, numa aba comum
  -NoBrowser       só inicia o servidor

  Compatível com Windows PowerShell 5.1 e PowerShell 7+.
#>
param(
  [int]$Port = 8000,
  [switch]$NoBrowser,
  [switch]$DefaultBrowser
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$gpuPreferencesKey = 'Software\Microsoft\DirectX\UserGpuPreferences'

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.bin'  = 'application/octet-stream'
  '.wasm' = 'application/wasm'
  '.ktx2' = 'image/ktx2'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.mp3'  = 'audio/mpeg'
  '.ogg'  = 'audio/ogg'
  '.wav'  = 'audio/wav'
}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

function Send-Response($context) {
  $request = $context.Request
  $response = $context.Response
  try {
    $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    if ($relative -eq '' -or $relative.EndsWith('/')) { $relative += 'index.html' }

    $path = $null
    try { $path = [IO.Path]::GetFullPath((Join-Path $root $relative)) } catch { }

    # Only files inside the project folder are ever served.
    $inside = $path -and $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)

    if ($inside -and (Test-Path -LiteralPath $path -PathType Leaf)) {
      $extension = [IO.Path]::GetExtension($path).ToLowerInvariant()
      $response.ContentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($path)
    } else {
      $response.StatusCode = 404
      $response.ContentType = 'text/plain; charset=utf-8'
      $bytes = [Text.Encoding]::UTF8.GetBytes('404 - arquivo não encontrado')
    }

    $response.Headers['Cache-Control'] = 'no-cache'
    $response.ContentLength64 = $bytes.Length
    if ($request.HttpMethod -ne 'HEAD') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    Write-Host ('  {0}  {1}' -f $response.StatusCode, $request.Url.AbsolutePath)
  } catch {
    # The browser closed the connection mid-response: nothing to do.
  } finally {
    $response.Close()
  }
}

# ---------------------------------------------------------------------------
# Browser + graphics card
# ---------------------------------------------------------------------------

function Test-Windows {
  return [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
}

# Chrome first, then Edge: both are Chromium and accept the switches used below.
function Find-ChromiumBrowser {
  $bases = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }
  $relatives = @('Google\Chrome\Application\chrome.exe', 'Microsoft\Edge\Application\msedge.exe')
  foreach ($relative in $relatives) {
    foreach ($base in $bases) {
      $path = [IO.Path]::Combine($base, $relative)
      if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
  }
  return $null
}

# Windows keeps one "GpuPreference=N;" entry per program (0 = automatic,
# 1 = power saving, 2 = high performance), next to other settings.
function Get-UpdatedGpuPreference([string]$current) {
  if ($current -match 'GpuPreference=\d;') { return $current -replace 'GpuPreference=\d;', 'GpuPreference=2;' }
  return $current + 'GpuPreference=2;'
}

function Get-GpuPreference([string]$exe) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($gpuPreferencesKey)
  if (-not $key) { return '' }
  try { return [string]$key.GetValue($exe, '') } finally { $key.Close() }
}

function Set-HighPerformanceGpu([string]$exe) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($gpuPreferencesKey)
  try {
    $value = Get-UpdatedGpuPreference ([string]$key.GetValue($exe, ''))
    $key.SetValue($exe, $value, [Microsoft.Win32.RegistryValueKind]::String)
  } finally {
    $key.Close()
  }
}

# Asks once; a "no" is remembered so the question does not come back.
function Request-HighPerformanceGpu([string]$exe, [string]$stateDir) {
  if ((Get-GpuPreference $exe) -match 'GpuPreference=2;') { return }
  $declined = [IO.Path]::Combine($stateDir, 'gpu-preference-declined.txt')
  if ((Test-Path -LiteralPath $declined) -and ((Get-Content -LiteralPath $declined -Raw).Trim() -eq $exe)) { return }

  $name = [IO.Path]::GetFileName($exe)
  Write-Host '  Em notebooks com duas placas de vídeo (ex.: Intel + NVIDIA), o Windows costuma'
  Write-Host '  rodar o navegador na mais fraca e o projeto trava.'
  Write-Host "  Posso configurar o Windows para usar a placa de alto desempenho no $name"
  Write-Host '  (o mesmo que Configurações > Sistema > Tela > Elementos gráficos > Alto desempenho;'
  Write-Host '  pode ser desfeito por lá).'
  $answer = Read-Host '  Configurar agora? [S/n]'
  if ($answer -match '^\s*(s|sim|y|yes)?\s*$') {
    Set-HighPerformanceGpu $exe
    Write-Host '  Pronto: o Windows vai usar a placa de alto desempenho nesse navegador.'
  } else {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -LiteralPath $declined -Value $exe
  }
  Write-Host ''
}

function Get-BrowserArguments([string]$url, [string]$profileDir) {
  # A separate profile starts a separate browser instance, so these switches
  # apply even when the browser is already open.
  return @(
    "--user-data-dir=`"$profileDir`"",
    '--force-high-performance-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    "--app=$url"
  )
}

function Open-Project([string]$url) {
  $browser = $null
  if (-not $DefaultBrowser -and (Test-Windows)) { $browser = Find-ChromiumBrowser }

  if (-not $browser) {
    try { Start-Process $url } catch { Write-Host "  Abra $url no navegador." }
    return
  }

  $stateDir = [IO.Path]::Combine($env:LOCALAPPDATA, 'HumanHeart')
  try {
    Request-HighPerformanceGpu $browser $stateDir
  } catch {
    Write-Host "  Não foi possível ajustar a preferência de GPU do Windows: $($_.Exception.Message)"
  }

  $arguments = Get-BrowserArguments $url ([IO.Path]::Combine($stateDir, 'browser-profile'))
  Start-Process -FilePath $browser -ArgumentList $arguments
  Write-Host "  Janela aberta no $([IO.Path]::GetFileName($browser)), pedindo a placa de vídeo de alto desempenho."
  Write-Host '  Confira no painel do projeto: a NVIDIA aparece com um ponto verde.'
  Write-Host ''
}

# ---------------------------------------------------------------------------
# Main (skipped when the script is dot-sourced, e.g. by tests)
# ---------------------------------------------------------------------------

if ($MyInvocation.InvocationName -eq '.') { return }

# Use the first free port starting at $Port.
$listener = $null
for ($candidate = $Port; $candidate -lt $Port + 20; $candidate++) {
  $attempt = New-Object System.Net.HttpListener
  $attempt.Prefixes.Add("http://localhost:$candidate/")
  try {
    $attempt.Start()
    $listener = $attempt
    $Port = $candidate
    break
  } catch {
    $attempt.Close()
  }
}

if (-not $listener) {
  Write-Host "Nenhuma porta livre entre $Port e $($Port + 19). Feche outros servidores e tente de novo."
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  HUMAN HEART - servidor local'
Write-Host "  Endereço: $url"
Write-Host '  Deixe esta janela aberta enquanto usa o projeto. Para parar: feche-a ou pressione Ctrl+C.'
Write-Host ''

if (-not $NoBrowser) { Open-Project $url }

try {
  while ($listener.IsListening) {
    $pending = $listener.GetContextAsync()
    # Short waits keep Ctrl+C responsive.
    while (-not $pending.Wait(500)) { }
    Send-Response $pending.Result
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
