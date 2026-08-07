[CmdletBinding()]
param(
    [switch] $SkipPull,
    [switch] $Install
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $FilePath,

        [Parameter()]
        [string[]] $Arguments = @()
    )

    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $joined = $Arguments -join ' '
        throw "Command failed (exit=$exitCode): $FilePath $joined"
    }
}

function Get-GitOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    $output = & git @Arguments
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $joined = $Arguments -join ' '
        throw "Git command failed (exit=$exitCode): git $joined"
    }

    return $output
}

function Get-GitSingleLine {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    $lines = @(
        Get-GitOutput -Arguments $Arguments
    )

    if ($lines.Count -ne 1) {
        $joined = $Arguments -join ' '
        throw "Expected one line from: git $joined; actual=$($lines.Count)"
    }

    return ([string] $lines[0]).Trim()
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    Write-Host '============================================================'
    Write-Host 'Kiwoom Desk pull and verification'
    Write-Host "repo=$repoRoot"
    Write-Host '============================================================'

    $insideWorkTree = Get-GitSingleLine -Arguments @(
        'rev-parse',
        '--is-inside-work-tree'
    )

    if ($insideWorkTree -ne 'true') {
        throw "Not a Git working tree: $repoRoot"
    }

    $dirtyBefore = @(
        Get-GitOutput -Arguments @(
            'status',
            '--porcelain'
        )
    )

    if ($dirtyBefore.Count -gt 0) {
        Write-Host ''
        Write-Host 'Local changes detected:' -ForegroundColor Yellow
        $dirtyBefore | ForEach-Object { Write-Host $_ }
        throw 'Working tree is not clean. Commit, stash, or discard local changes before pulling.'
    }

    if (-not $SkipPull) {
        Write-Host ''
        Write-Host '[1/5] Pulling origin/main with fast-forward only...'
        Invoke-Native -FilePath 'git' -Arguments @(
            'pull',
            '--ff-only',
            'origin',
            'main'
        )
    }
    else {
        Write-Host ''
        Write-Host '[1/5] Pull skipped.'
    }

    Write-Host ''
    Write-Host '[2/5] Checking dependencies...'

    $needsInstall = $Install -or -not (Test-Path 'node_modules')

    if ($needsInstall) {
        if (Test-Path 'package-lock.json') {
            Invoke-Native -FilePath 'npm' -Arguments @('ci')
        }
        else {
            Invoke-Native -FilePath 'npm' -Arguments @('install')
        }
    }
    else {
        Write-Host 'node_modules exists; install skipped.'
    }

    Write-Host ''
    Write-Host '[3/5] Running production build...'
    Invoke-Native -FilePath 'npm' -Arguments @(
        'run',
        'build'
    )

    Write-Host ''
    Write-Host '[4/5] Checking whitespace and repository cleanliness...'
    Invoke-Native -FilePath 'git' -Arguments @(
        'diff',
        '--check'
    )
    Invoke-Native -FilePath 'git' -Arguments @(
        'diff',
        '--cached',
        '--check'
    )

    $dirtyAfter = @(
        Get-GitOutput -Arguments @(
            'status',
            '--porcelain'
        )
    )

    if ($dirtyAfter.Count -gt 0) {
        Write-Host ''
        Write-Host 'Build or verification changed the working tree:' -ForegroundColor Yellow
        $dirtyAfter | ForEach-Object { Write-Host $_ }
        throw 'Verification completed with local changes. The repository must remain clean.'
    }

    Write-Host ''
    Write-Host '[5/5] Verifying local main against origin/main...'

    Invoke-Native -FilePath 'git' -Arguments @(
        'fetch',
        'origin',
        'main'
    )

    $localHead = Get-GitSingleLine -Arguments @(
        'rev-parse',
        'HEAD'
    )

    $remoteHead = Get-GitSingleLine -Arguments @(
        'rev-parse',
        'origin/main'
    )

    if ($localHead -ne $remoteHead) {
        throw "Local HEAD ($localHead) does not match origin/main ($remoteHead)."
    }

    Write-Host ''
    Invoke-Native -FilePath 'git' -Arguments @(
        'status',
        '-sb'
    )
    Invoke-Native -FilePath 'git' -Arguments @(
        'log',
        '-3',
        '--oneline'
    )

    Write-Host ''
    Write-Host 'VERIFICATION PASSED' -ForegroundColor Green
    Write-Host "head=$localHead"
}
finally {
    Pop-Location
}
