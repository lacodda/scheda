# scheda installer for Windows:
#   irm https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.ps1 | iex
#
# Installs - or updates - scheda for the current user, from the latest release:
# no administrator, nothing outside your own account. Under the hood it runs the
# release's own installer silently, which is what registers scheda as a handler
# for markdown and puts it in the Start menu and in Apps (ADR 0015).
$ErrorActionPreference = "Stop"

$repo = "lacodda/scheda"

# The tag comes from the /releases/latest redirect rather than the REST API:
# unauthenticated API calls are capped at 60 per hour per IP, and an installer
# that fails because someone else on the same address ran it is no installer.
# $env:SCHEDA_VERSION pins a specific release.
$tag = $env:SCHEDA_VERSION
if (-not $tag) {
    $request = [Net.HttpWebRequest]::Create("https://github.com/$repo/releases/latest")
    $request.AllowAutoRedirect = $false
    $request.UserAgent = "scheda-installer"
    try {
        $response = $request.GetResponse()
        $tag = ($response.Headers["Location"] -split "/")[-1]
        $response.Close()
    } catch {
        throw "Cannot resolve the latest release of ${repo}: $($_.Exception.Message)"
    }
}
if (-not $tag -or $tag -notmatch '^v\d+\.\d+\.\d+$') {
    throw "Cannot resolve the latest release of $repo - set `$env:SCHEDA_VERSION to a release tag (vX.Y.Z)"
}
$version = $tag.Substring(1)

# Where the release's installer puts scheda for the current user.
$target = Join-Path $env:LOCALAPPDATA "scheda\scheda.exe"

# An open window may hold text that is not saved yet, and replacing the program
# under it would mean closing it. That is the person's to do, not ours.
if (Get-Process scheda -ErrorAction SilentlyContinue) {
    throw "scheda is running - save what is open, close it, and run the installer again"
}

$name = "scheda_${version}_x64-setup.exe"
$url = "https://github.com/$repo/releases/download/$tag/$name"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "scheda-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp | Out-Null

try {
    $setup = Join-Path $tmp $name
    Write-Host "Downloading $url"
    # The progress bar of Windows PowerShell slows the download itself down by
    # an order of magnitude.
    $progress = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
        Invoke-WebRequest $url -OutFile $setup -UseBasicParsing
    } finally {
        $ProgressPreference = $progress
    }

    # Silent, for this user only. Started as a process of its own and waited
    # for: the arguments reach the installer intact only this way.
    $run = Start-Process -FilePath $setup -ArgumentList "/S", "/CURRENTUSER" -PassThru -Wait
    if ($run.ExitCode -eq 2) {
        # An upgrade can stop at the old version's uninstaller, which the
        # installer runs first and gives up on when it does not answer 0. Its
        # update mode installs over the old files instead, and keeps the data.
        $run = Start-Process -FilePath $setup -ArgumentList "/S", "/UPDATE", "/CURRENTUSER" -PassThru -Wait
    }
    if ($run.ExitCode -ne 0) {
        throw "The installer stopped with code $($run.ExitCode)"
    }
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# The file, not the exit code, says what is installed: an installer can finish
# cleanly and leave the old version in place.
if (-not (Test-Path $target)) {
    throw "The installer finished, but $target is not there"
}
$installed = (Get-Item $target).VersionInfo.FileVersion
if ($installed -ne $version) {
    throw "The installer finished, but $target is version $installed rather than $version"
}
Write-Host "Installed scheda $tag to $target"

# A copy installed for every user, by the .msi older releases carried, would
# sit beside this one in Apps and in "Open with".
$machine = @(Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "scheda" })
foreach ($copy in $machine) {
    Write-Host "Note: another scheda $($copy.DisplayVersion) is installed for all users - remove it in Settings > Apps."
}

Write-Host "Open a .md file with it, or make it the default: Settings > Apps > Default apps > scheda."
