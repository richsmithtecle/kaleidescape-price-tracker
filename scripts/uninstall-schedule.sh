#!/bin/zsh
# Removes the scheduled collector job.
LABEL="local.kaleidescape-price-tracker.collect"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && echo "Stopped $LABEL" || echo "$LABEL was not loaded"
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist" && echo "Removed plist"
