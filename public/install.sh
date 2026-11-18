#!/bin/sh
# Installs or updates Slate and puts the `slate` command on your PATH:
#   curl -fsSL https://slate.appusta.com/install.sh | sh
# SLATE_HOME (default ~/.slate) is where it goes, SLATE_BIN where the command is linked, SLATE_REF the branch.
# Your boards in $SLATE_HOME/data are never touched.
set -eu

DIR="${SLATE_HOME:-$HOME/.slate}"
REF="${SLATE_REF:-main}"
say() { printf '%s\n' "$*"; }
fail() { say "slate: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "needs Node.js 18 or newer: https://nodejs.org"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || fail "needs Node.js 18 or newer (found $(node -v))"
command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || fail "needs curl and tar"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/admcilgin/slate/tar.gz/refs/heads/$REF" | tar -xz -C "$tmp" --strip-components=1 \
  || fail "could not download Slate ($REF)"
mkdir -p "$DIR"
cp -R "$tmp/." "$DIR/" # the download has no data/, so boards and settings stay as they are
chmod +x "$DIR/cli.js"

# First install: boards go to ~/Slate, a folder you can see and pick in the browser (~/.slate is hidden).
BOARDS="$HOME/Slate"
if [ ! -f "$DIR/.slate-data" ] && [ ! -d "$DIR/data/boards" ]; then
  mkdir -p "$BOARDS"
  node "$DIR/cli.js" use "$BOARDS" >/dev/null
fi
BOARDS=$(node "$DIR/cli.js" use | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).dataDir)')

# A folder already on PATH that we can write to, or ~/.local/bin added to PATH.
BIN="${SLATE_BIN:-}"
if [ -z "$BIN" ]; then
  for d in "$HOME/.local/bin" "$HOME/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$d:"*) if [ -d "$d" ] && [ -w "$d" ]; then BIN=$d; break; fi ;; esac
  done
fi
BIN="${BIN:-$HOME/.local/bin}"
mkdir -p "$BIN"
ln -sf "$DIR/cli.js" "$BIN/slate"

case ":$PATH:" in
  *":$BIN:"*) fresh="" ;;
  *)
    case "${SHELL:-}" in
      */zsh) rc="$HOME/.zshrc" ;;
      */bash) if [ "$(uname)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
      */fish) rc="$HOME/.config/fish/config.fish" ;;
      *) rc="$HOME/.profile" ;;
    esac
    if ! grep -qs "# added by slate" "$rc"; then
      mkdir -p "$(dirname "$rc")"
      case "$rc" in
        *.fish) printf '\nfish_add_path "%s" # added by slate\n' "$BIN" >> "$rc" ;;
        *) printf '\nexport PATH="%s:$PATH" # added by slate\n' "$BIN" >> "$rc" ;;
      esac
    fi
    fresh="$rc"
    ;;
esac

"$BIN/slate" install 2>/dev/null || say "No agent found for the skill yet; run \`slate install\` after installing Claude Code, Codex or Copilot."

say ""
say "Slate is installed. Your boards are files in $BOARDS."
say ""
say "  See them   Open ${SLATE_WEB:-https://slate.appusta.com} in Chrome, Edge or Brave and pick that folder,"
say "             or run \`slate start\` for a local copy at http://localhost:4747"
say "  Use them   Ask Claude Code, Codex or Copilot: \"put the login flow on my Slate board\""
say "  Commands   slate status, slate show demo, or just slate for the list"
if [ -n "$fresh" ]; then
  say ""
  say "Open a new terminal for the \`slate\` command, or run: export PATH=\"$BIN:\$PATH\""
fi
