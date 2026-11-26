#!/bin/zsh
# Installs a macOS launchd job that runs the collector at 3:30 AM and 3:30 PM (local time).
# If the Mac is asleep at that time, the run happens as soon as it wakes.
# Undo with: scripts/uninstall-schedule.sh
set -e
LABEL="local.kaleidescape-price-tracker.collect"
ROOT="${0:A:h:h}"
NODE="${NODE_BIN:-$HOME/.local/node/bin/node}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

[[ -x "$NODE" ]] || { echo "Node not found at $NODE (set NODE_BIN)"; exit 1; }
mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/src/collect.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$ROOT/logs/collect.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/collect.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $PLIST"
echo "Runs daily at 03:30 and 15:30. Log: $ROOT/logs/collect.log"
echo "Run it now with: launchctl kickstart gui/$(id -u)/$LABEL"
