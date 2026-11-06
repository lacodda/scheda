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

# $env:SCHEDA_INSTALL_DIR installs a copy apart: the program alone, in that
# directory, from the archive the release carries of it. The release's installer
# cannot do that: it would register the copy as the handler for markdown and in
# Apps, which is the person's own scheda and not a trial's.
$apart = $env:SCHEDA_INSTALL_DIR
$dir = if ($apart) { $apart } else { Join-Path $env:LOCALAPPDATA "scheda" }
$installed = Join-Path $dir "scheda.exe"

$tmp = Join-Path ([IO.Path]::GetTempPath()) "scheda-install-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp | Out-Null

function Get-Release($name, $to) {
    $url = "https://github.com/$repo/releases/download/$tag/$name"
    Write-Host "Downloading $url"
    # The progress bar of Windows PowerShell slows the download itself down by
    # an order of magnitude.
    $progress = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
        Invoke-WebRequest $url -OutFile $to -UseBasicParsing
    } finally {
        $ProgressPreference = $progress
    }
}

# An open window may hold text that is not saved yet, and it is not an installer's
# to close (the release's own would: silently, it shuts down whatever holds the
# file it replaces). A running program cannot be overwritten, but it can be
# renamed: it steps aside and goes on running, and the next launch is the new one.
# ADR 0022.
$aside = $null
if (Test-Path $installed) {
    $running = Get-Process scheda -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installed }
    if ($running) {
        $aside = "$installed.old-$([guid]::NewGuid())"
        Move-Item $installed $aside
    }
}

try {
    if ($apart) {
        # Named for the target, like every program of the line, so that a release
        # can be proven: the engine hashes what is installed against this archive.
        $target = "x86_64-pc-windows-msvc"
        $archive = Join-Path $tmp "scheda.zip"
        Get-Release "scheda-$tag-$target.zip" $archive
        Expand-Archive $archive -DestinationPath $tmp -Force
        New-Item -ItemType Directory -Force $dir | Out-Null
        Copy-Item (Join-Path $tmp "scheda.exe") $installed -Force
    } else {
        $name = "scheda_${version}_x64-setup.exe"
        $setup = Join-Path $tmp $name
        Get-Release $name $setup

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
    }
} catch {
    # Nothing new came: the program that stepped aside comes back.
    if ($aside -and -not (Test-Path $installed)) {
        Move-Item $aside $installed
    }
    throw
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# The file, not the exit code, says what is installed: an installer can finish
# cleanly and leave the old version in place.
if (-not (Test-Path $installed)) {
    throw "The installer finished, but $installed is not there"
}
$found = (Get-Item $installed).VersionInfo.FileVersion
if ($found -ne $version) {
    throw "The installer finished, but $installed is version $found rather than $version"
}

# What stepped aside here or before, once nothing runs it any more.
Get-ChildItem $dir -Filter "scheda.exe.old-*" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

# $env:SCHEDA_NO_PATH leaves the PATH alone: an install into a scratch directory,
# such as `furca release verify --install`, must not add it.
#
# The user PATH is edited in the registry, not through the .NET environment API:
# that call rewrites the value as REG_SZ, and a PATH stored as REG_SZ no longer
# expands entries such as %JAVA_HOME%\bin - they turn into literal text and
# silently stop working. Reading the raw value keeps those entries as typed;
# writing it back as ExpandString keeps the type. A PATH that cannot be edited is
# not a failed install: the program is in place, and the person is told where.
if (-not $env:SCHEDA_NO_PATH) {
    try {
        $key = Get-Item "HKCU:\Environment"
        $raw = [string]$key.GetValue("Path", "", "DoNotExpandEnvironmentNames")
        $entries = @($raw -split ";" | Where-Object { $_ })
        $wanted = $dir.TrimEnd("\")
        $present = $entries | Where-Object { $_.TrimEnd("\") -ieq $wanted }
        if (-not $present) {
            $value = if ($entries.Count -gt 0) { ($entries + $wanted) -join ";" } else { $wanted }
            Set-ItemProperty -Path "HKCU:\Environment" -Name Path -Value $value -Type ExpandString
            # Tell running shells and Explorer that the environment changed, the
            # way the System Properties dialog does; without it only new logins
            # see the entry.
            if (-not ("SchedaInstall.Env" -as [type])) {
                Add-Type -Namespace SchedaInstall -Name Env -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
            }
            $result = [System.UIntPtr]::Zero
            # HWND_BROADCAST = 0xffff, WM_SETTINGCHANGE = 0x1A, SMTO_ABORTIFHUNG = 0x2
            [SchedaInstall.Env]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 0x2, 5000, [ref]$result) | Out-Null
            Write-Host "Added $dir to your user PATH - open a new terminal to pick it up."
        }
    } catch {
        Write-Host "Note: could not update the user PATH ($($_.Exception.Message)); add $dir to it yourself."
    }
}

Write-Host "Installed scheda $tag to $installed"
if ($aside) {
    Write-Host "The scheda window that is open goes on as it was. Close it when you are done with it, and the next launch is $tag."
}

# A copy installed for every user, by the .msi older releases carried, would
# sit beside this one in Apps and in "Open with".
$machine = @(Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -eq "scheda" })
if (-not $apart) {
    foreach ($copy in $machine) {
        Write-Host "Note: another scheda $($copy.DisplayVersion) is installed for all users - remove it in Settings > Apps."
    }

    Write-Host "Open a .md file with it, or make it the default: Settings > Apps > Default apps > scheda."
}
