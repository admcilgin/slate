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
say "Slate is in $DIR, and \`slate\` in $BIN."
if [ -n "$fresh" ]; then
  say "Added $BIN to your PATH in $fresh. Open a new terminal, or run:"
  say "  export PATH=\"$BIN:\$PATH\""
fi
say "Try: slate status"
