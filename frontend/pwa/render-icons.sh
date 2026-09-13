#!/usr/bin/env bash
# Render pwa/icon.svg to the PNG sizes the web manifest and iOS ask for.
# The PNGs are committed, so this only needs running when the icon changes.
# Uses headless Chrome because it renders SVG exactly as a browser will.
set -euo pipefail
cd "$(dirname "$0")/.."
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp pwa/icon.svg "$tmp/icon.svg"
cat > "$tmp/icon.html" <<'EOF'
<!doctype html><html><body style="margin:0"><img src="icon.svg" style="display:block;width:100vw;height:100vh"></body></html>
EOF

render() {  # size output
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$tmp/profile" --window-size="$1,$1" \
    --screenshot="$PWD/public/$2" "file://$tmp/icon.html" 2>/dev/null
}
render 192 icon-192.png
render 512 icon-512.png
render 512 icon-maskable-512.png   # same art: it already respects the safe zone
render 180 apple-touch-icon.png
echo "rendered: $(ls public/*.png | tr '\n' ' ')"
