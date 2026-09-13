#!/usr/bin/env bash
# Render pwa/icon.svg to every PNG the app needs:
#
#   public/          the web manifest's icons and the iOS home-screen icon
#   assets/logo.png  the drawing on transparent, which `npx @capacitor/assets
#                    generate` turns into the Android launcher icons and splash
#
# The PNGs are committed, so this only needs running when the icon changes.
# Headless Chrome, because it renders SVG exactly as a browser will.
set -euo pipefail
cd "$(dirname "$0")/.."
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp pwa/icon.svg "$tmp/icon.svg"
# The same drawing without its paper, for Android to set on its own background
# and fit to whatever mask the launcher uses.
sed '/<rect /d' pwa/icon.svg > "$tmp/logo.svg"

page() {  # svg html
  printf '<!doctype html><html><body style="margin:0;background:transparent"><img src="%s" style="display:block;width:100vw;height:100vh"></body></html>' "$1" > "$tmp/$2"
}
page icon.svg icon.html
page logo.svg logo.html

render() {  # size html output
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$tmp/profile" --window-size="$1,$1" \
    --default-background-color=00000000 \
    --screenshot="$PWD/$3" "file://$tmp/$2" 2>/dev/null
}
render 192 icon.html public/icon-192.png
render 512 icon.html public/icon-512.png
render 512 icon.html public/icon-maskable-512.png   # same art: it already respects the safe zone
render 180 icon.html public/apple-touch-icon.png
mkdir -p assets
render 1024 logo.html assets/logo.png
echo "rendered: $(ls public/*.png assets/logo.png | tr '\n' ' ')"
