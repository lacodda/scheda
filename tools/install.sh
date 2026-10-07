#!/bin/sh
# scheda installer for macOS (Apple silicon) and Linux (x86_64):
#   curl -fsSL https://raw.githubusercontent.com/lacodda/scheda/main/tools/install.sh | sh
#
# Installs - or updates - scheda for the current user, from the latest release,
# and puts `scheda` on the command line so it can open a file from a terminal
# or serve as $EDITOR (ADR 0015).
set -eu

REPO="lacodda/scheda"

case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) PLATFORM="linux" ;;
    Darwin-arm64) PLATFORM="macos" ;;
    Darwin-x86_64)
        echo "scheda is built for Apple silicon only; on an Intel Mac, build it from source:" >&2
        echo "  https://github.com/$REPO/blob/main/CONTRIBUTING.md" >&2
        exit 1
        ;;
    # Git Bash, MSYS2 and Cygwin run this script happily on Windows, where it
    # has no business being: the Windows build is installed by install.ps1.
    # Saying so beats a "no build for this platform" dead end, since a Windows
    # release does exist - just not for this installer.
    MINGW*|MSYS*|CYGWIN*)
        echo "This is the macOS/Linux installer, but you are on Windows ($(uname -s))." >&2
        echo "Install with PowerShell instead:" >&2
        echo "  irm https://raw.githubusercontent.com/$REPO/main/tools/install.ps1 | iex" >&2
        exit 1
        ;;
    *)
        echo "No build of scheda for $(uname -s)/$(uname -m); build it from source:" >&2
        echo "  https://github.com/$REPO/blob/main/CONTRIBUTING.md" >&2
        exit 1
        ;;
esac

# The tag comes from the /releases/latest redirect rather than the REST API:
# unauthenticated API calls are capped at 60 per hour per IP, and an installer
# that fails because someone else on the same address ran it is no installer.
# SCHEDA_VERSION pins a specific release.
TAG="${SCHEDA_VERSION:-}"
if [ -z "$TAG" ]; then
    LOCATION=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" || true)
    TAG="${LOCATION##*/}"
fi
case "$TAG" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *)
        echo "Cannot resolve the latest release of $REPO - set SCHEDA_VERSION to a release tag (vX.Y.Z)" >&2
        exit 1
        ;;
esac
VERSION="${TAG#v}"
RELEASE="https://github.com/$REPO/releases/download/$TAG"

# An open window may hold text that is not saved yet, and replacing the program
# under it would mean closing it. That is the person's to do, not ours.
if pgrep -x scheda >/dev/null 2>&1 || pgrep -f 'scheda\.AppImage' >/dev/null 2>&1; then
    echo "scheda is running - save what is open, close it, and run the installer again" >&2
    exit 1
fi

BIN_DIR="${SCHEDA_BIN_DIR:-$HOME/.local/bin}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ "$PLATFORM" = "macos" ]; then
    APPS="${SCHEDA_APPLICATIONS:-$HOME/Applications}"
    URL="$RELEASE/scheda_${VERSION}_aarch64.app.tar.gz"
    echo "Downloading $URL"
    curl -fsSL "$URL" | tar xz -C "$TMP"
    [ -d "$TMP/scheda.app" ] || { echo "The archive did not contain scheda.app" >&2; exit 1; }
    mkdir -p "$APPS"
    # Replaced whole rather than merged: files a new version dropped must not
    # linger inside the bundle.
    rm -rf "$APPS/scheda.app"
    mv "$TMP/scheda.app" "$APPS/scheda.app"
    # The build is not notarised; downloaded by curl it carries no quarantine
    # mark, but a copy fetched by a browser earlier might.
    xattr -dr com.apple.quarantine "$APPS/scheda.app" 2>/dev/null || true
    INSTALLED=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APPS/scheda.app/Contents/Info.plist")
    PROGRAM="$APPS/scheda.app/Contents/MacOS/scheda"
    WHERE="$APPS/scheda.app"
else
    DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
    URL="$RELEASE/scheda_${VERSION}_amd64.AppImage"
    echo "Downloading $URL"
    curl -fsSL -o "$TMP/scheda.AppImage" "$URL"
    mkdir -p "$DATA/scheda"
    install -m 755 "$TMP/scheda.AppImage" "$DATA/scheda/scheda.AppImage"
    # The version the file was downloaded as. An AppImage does not answer for
    # its version without starting, and starting it means a window.
    printf '%s\n' "$VERSION" > "$DATA/scheda/version"
    INSTALLED="$VERSION"
    PROGRAM="$DATA/scheda/scheda.AppImage"
    WHERE="$PROGRAM"

    # A launcher entry, so scheda is in the applications menu and offered in
    # "Open with" for markdown. Offered, not made the default: which editor
    # opens .md is the person's choice (xdg-mime, below).
    mkdir -p "$DATA/applications" "$DATA/icons/hicolor/128x128/apps"
    curl -fsSL -o "$DATA/icons/hicolor/128x128/apps/scheda.png" \
        "https://raw.githubusercontent.com/$REPO/$TAG/src-tauri/icons/128x128.png" || true
    cat > "$DATA/applications/scheda.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=scheda
Comment=A markdown notepad that turns into a vault when there is a folder around it.
Exec="$PROGRAM" %f
Icon=scheda
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
EOF
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
    fi
fi

if [ "$INSTALLED" != "$VERSION" ]; then
    echo "Installed $WHERE, but it is version $INSTALLED rather than $VERSION" >&2
    exit 1
fi

# `scheda` on the command line: a link to the program rather than a copy, so
# the next update cannot leave it behind.
mkdir -p "$BIN_DIR"
ln -sf "$PROGRAM" "$BIN_DIR/scheda"
echo "Installed scheda $TAG to $WHERE"

case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "Note: add $BIN_DIR to your PATH to run scheda from a terminal." ;;
esac
if [ "$PLATFORM" = "linux" ]; then
    # Many distributions no longer ship the FUSE 2 library an AppImage mounts
    # itself with. Looked for as a file: `ldconfig` is often outside a user's
    # PATH, and its absence is not the library's.
    FUSE=""
    for lib in /lib/libfuse.so.2* /lib64/libfuse.so.2* /usr/lib/libfuse.so.2* /usr/lib64/libfuse.so.2* \
        /lib/*-linux-gnu/libfuse.so.2* /usr/lib/*-linux-gnu/libfuse.so.2*; do
        [ -e "$lib" ] && FUSE="$lib" && break
    done
    if [ -z "$FUSE" ]; then
        echo "Note: scheda needs FUSE 2 to start (Debian/Ubuntu: sudo apt install libfuse2)."
    fi
    echo "To make scheda the default for markdown: xdg-mime default scheda.desktop text/markdown"
fi
