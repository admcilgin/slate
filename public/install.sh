#!/bin/sh
# Installs or updates Slate and puts the `slate` command on your PATH:
#   curl -fsSL https://slate.appusta.com/install.sh | sh
# SLATE_HOME (default ~/.slate) is where Slate goes, SLATE_BIN where the command is linked, SLATE_WEB the site
# to download from. The code comes from the same deploy as this script, so the two always match.
# Your boards are never touched.
set -eu

WEB="${SLATE_WEB:-https://slate.appusta.com}"
DIR="${SLATE_HOME:-$HOME/.slate}"
say() { printf '%s\n' "$*"; }
fail() { say "slate: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "needs Node.js 18 or newer: https://nodejs.org"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || fail "needs Node.js 18 or newer (found $(node -v))"
command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || fail "needs curl and tar"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$WEB/slate.tar.gz" -o "$tmp/slate.tar.gz" || fail "could not download $WEB/slate.tar.gz"
mkdir "$tmp/src"
tar -xzf "$tmp/slate.tar.gz" -C "$tmp/src" && [ -f "$tmp/src/cli.js" ] || fail "the download is damaged; run the installer again"
mkdir -p "$DIR"
cp -R "$tmp/src/." "$DIR/" # the download has no data/, so boards and settings stay as they are
chmod +x "$DIR/cli.js"

# The command first, so a later problem never leaves you without it: a folder already on PATH that we can
# write to, or ~/.local/bin added to PATH in your shell's startup file.
BIN="${SLATE_BIN:-}"
if [ -z "$BIN" ]; then
  for d in "$HOME/.local/bin" "$HOME/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$d:"*) if [ -d "$d" ] && [ -w "$d" ]; then BIN=$d; break; fi ;; esac
  done
fi
BIN="${BIN:-$HOME/.local/bin}"
mkdir -p "$BIN"
ln -sf "$DIR/cli.js" "$BIN/slate"

fresh=""
case ":$PATH:" in
  *":$BIN:"*) ;;
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

# First install: boards go to ~/Slate, a folder you can see and pick in the browser (~/.slate is hidden).
# A data/ holding nothing but an untouched demo board is an earlier install that never got further.
unused() {
  [ -f "$DIR/.slate-data" ] && return 1
  for f in "$DIR"/data/boards/*.json; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = demo.json ] && cmp -s "$f" "$DIR/demo.json" && continue
    return 1
  done
}
if unused; then
  pick="$HOME/Slate"
  # Boards already in a folder picked on the web copy: use that one, so the browser and agents share it.
  # Read from the terminal, as stdin is this script; with no terminal (CI, say) it is ~/Slate.
  if (exec 3</dev/tty) 2>/dev/null; then
    exec 3</dev/tty
    printf '\nAlready picked a boards folder on %s? Drag it here and press Enter.\nOr just press Enter for %s: ' "$WEB" "$pick"
    ans=""; IFS= read -r ans <&3 || ans=""
    exec 3<&-
    ans=$(printf '%s' "$ans" | sed -e 's/[[:space:]]*$//' -e "s/^[\"']//" -e "s/[\"']\$//" -e 's/\\\(.\)/\1/g') # a dragged path may come quoted or with \ before spaces
    case "$ans" in "~"*) ans="$HOME${ans#\~}" ;; esac
    if [ -n "$ans" ]; then
      [ -d "$ans" ] && pick="$ans" || say "No folder at $ans; using $pick. Change it later with: slate use <folder>"
    fi
  fi
  mkdir -p "$pick"
  node "$DIR/cli.js" use "$pick" >/dev/null || fail "could not set up $pick"
fi
BOARDS=$(node "$DIR/cli.js" status | node -e 'process.stdout.write(require("path").dirname(JSON.parse(require("fs").readFileSync(0, "utf8")).boardsDir))') \
  || fail "slate status failed; run it to see why"

"$BIN/slate" install >/dev/null 2>&1 && agents="Your agents know about Slate now." \
  || agents="No agent found yet: run \`slate install\` after installing Claude Code, Codex or Copilot."

say ""
say "Slate is installed. Your boards are files in $BOARDS."
say "$agents"
say ""
say "  See them   Open $WEB in Chrome, Edge or Brave and pick that folder,"
say "             or run \`slate start\` for a local copy and open the address it prints"
say "  Use them   Ask your agent: \"put the login flow on my Slate board\""
say "  Commands   slate status, slate show demo, or just slate for the list"
if [ -n "$fresh" ]; then
  say ""
  say "Open a new terminal for the \`slate\` command, or run: export PATH=\"$BIN:\$PATH\""
fi
