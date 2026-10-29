#Requires -Version 5.1
<#
  部署脚本 —— 把仓库里的构建产物同步到正在运行的 DSH profile。

  为什么需要单独一步：插件是"复制安装"到
  %USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-corner-gauge
  的（不是 junction），所以改仓库 / 重新 build 都不会自动生效。

  用法（在仓库根目录）：
      pwsh -File scripts/deploy.ps1
      pwsh -File scripts/deploy.ps1 -Profile desktop
      pwsh -File scripts/deploy.ps1 -Restart      # 部署后顺便重启 App

  部署完：在 GUI 里按 Ctrl+R 刷新页面；若仍未生效（客户端插件有缓存），
  再重启一次 DeepSeek Harness。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$Repo = Split-Path -Parent $PSScriptRoot
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$Target = Join-Path $DshHome "profiles\$Profile\node_modules\dsh-corner-gauge"

Write-Host "仓库  : $Repo"
Write-Host "目标  : $Target"

if (-not (Test-Path $Target)) {
  Write-Error "目标目录不存在。请先在插件列表里安装 dsh-corner-gauge（profile = $Profile）。"
}

# ---- 1. 产物必须与 src 一致（避免部署过期产物）----
$build = Join-Path $Repo 'scripts\build.mjs'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $candidates = @(
    (Join-Path $DshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe')
  )
  $node = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($node -and (Test-Path $build)) {
  Write-Host '重新构建产物 ...'
  & $node $build | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Error '构建失败，已中止部署。' }
} else {
  Write-Warning '找不到 node 或 build.mjs，直接部署现有 lib/client.js。'
}

# ---- 2. 备份 + 覆盖 ----
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($rel in @('lib/client.js', 'lib/index.js', 'package.json', 'cordis.patch.yml')) {
  $src = Join-Path $Repo $rel
  $dst = Join-Path $Target $rel
  if (-not (Test-Path $src)) { Write-Warning "跳过（仓库里没有）：$rel"; continue }

  $dstDir = Split-Path -Parent $dst
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }

  if (Test-Path $dst) { Copy-Item $dst "$dst.bak-$stamp" -Force }
  Copy-Item $src $dst -Force

  $same = (Get-FileHash $src).Hash -eq (Get-FileHash $dst).Hash
  $size = (Get-Item $dst).Length
  Write-Host ("  {0,-20} {1,8} B  {2}" -f $rel, $size, $(if ($same) { 'OK' } else { '不一致!' }))
}

Write-Host ("`n部署完成（备份后缀 .bak-{0}）。" -f $stamp)

# ---- 3. 可选：重启 ----
if ($Restart) {
  $app = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
  if ($app) {
    Write-Host '正在重启 DeepSeek Harness ...'
    $app | Stop-Process -Force
    Start-Sleep -Seconds 2
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
    if (Test-Path $exe) { Start-Process $exe } else { Write-Warning "找不到可执行文件，请手动启动：$exe" }
  } else {
    Write-Warning '没有检测到正在运行的 DeepSeek Harness。'
  }
} else {
  Write-Host '下一步：在 GUI 里按 Ctrl+R 刷新页面；若样式没变化，重启 DeepSeek Harness。'
}
