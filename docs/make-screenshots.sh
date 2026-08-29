#!/usr/bin/env bash
# Regenerate the screenshots used in README.md.
#
# Needs ./start.sh running on the default dataset — the shots should show what a
# new user actually sees, which is the bundled 530-species example, not an 18k
# scrape. Screenshots go stale silently, so this exists to make redoing them one
# command rather than a fiddly manual job.
#
#   ./start.sh &                    # in another terminal
#   docs/make-screenshots.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/images"
URL="http://localhost:5173"
SEEDER="$ROOT/frontend/public/__shot.html"

command -v google-chrome >/dev/null || { echo "google-chrome not found"; exit 1; }
curl -sf -o /dev/null "$URL" || { echo "dev server not running — start ./start.sh first"; exit 1; }

mkdir -p "$OUT"

# A page on the app's own origin, so it can write the app's localStorage and then
# hand over to the app. Chrome cannot seed storage for an origin it has not
# loaded, which is the only reason this indirection exists. Removed on exit.
cat > "$SEEDER" <<'HTML'
<!doctype html><meta charset="utf-8"><title>seed</title><script>
const p = new URLSearchParams(location.search);
if (p.get('session')) localStorage.setItem('taxoquiz_session', p.get('session'));
else localStorage.removeItem('taxoquiz_session');
location.replace('/');
</script>
HTML
trap 'rm -f "$SEEDER"' EXIT

shot() {                       # shot <name> <width> <height> [session-json]
  local name=$1 w=$2 h=$3 session=${4-}
  local target="$URL/__shot.html"
  if [ -n "$session" ]; then
    target="$target?session=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$session")"
  fi
  google-chrome --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 \
    --window-size="$w,$h" --virtual-time-budget=15000 \
    --screenshot="$OUT/$name.png" "$target" >/dev/null 2>&1
  echo "  $name.png  $(du -h "$OUT/$name.png" | cut -f1)"
}

TODAY=$(date +%F)
# A real seed, not a placeholder: RZVM-X6N69Q genuinely resolves to "lion" on
# the bundled example dataset, so the seed in the screenshot is one a reader
# can actually type in and play.
GAME="{\"mode\":\"practice\",\"secret\":\"lion\",\"seed\":\"RZVM-X6N69Q\",\"guesses\":[\"tiger\",\"grey wolf\",\"earthworm\"],\"won\":false,\"date\":\"$TODAY\"}"

echo "Writing to docs/images/"
shot start 1000 330
shot game  1100 760 "$GAME"

# The taxon popup needs a *click*, which `chrome --screenshot` cannot do, so this
# one shot goes through playwright-cli instead. Skipped rather than fatal if it
# isn't installed — the other two are the important ones.
POPUP="{\"mode\":\"practice\",\"secret\":\"human\",\"seed\":\"RZVM-X6N69Q\",\"guesses\":[\"zebra\"],\"won\":false,\"date\":\"$TODAY\"}"
if command -v playwright-cli >/dev/null; then
  (
    cd "$ROOT"
    playwright-cli open "$URL"
    playwright-cli resize 1100 820
    playwright-cli localstorage-set taxoquiz_session "$POPUP"
    playwright-cli reload
    # Boreoeutheria is where zebra and human part company, so it is the node the
    # ??? hangs off — the most interesting one to open.
    playwright-cli click '[title^="Boreoeutheria"]'
    playwright-cli screenshot --filename "$OUT/taxon.png"
    playwright-cli close
    rm -rf "$ROOT/.playwright-cli"
  ) >/dev/null 2>&1
  echo "  taxon.png  $(du -h "$OUT/taxon.png" | cut -f1)"
else
  echo "  taxon.png  SKIPPED (playwright-cli not installed)"
fi

echo "Done. The game shot uses the README's worked example (lion vs tiger, grey"
echo "wolf, earthworm) so the picture and the prose agree, and its seed is real."
