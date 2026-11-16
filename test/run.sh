#!/bin/bash
# Simulated bots and people against Scan Guard (no FM-DX or tuner needed).
# Usage: bash test/run.sh [enforce|watch]
set -e
cd "$(dirname "$0")"
T=$(mktemp -d)
cp -r fake-app "$T/app"
mkdir -p "$T/app/plugins" "$T/home"
cp -r ../ScanGuard "$T/app/plugins/"
HOME="$T/home" node sim.js "$T/app" "${1:-enforce}"
rm -rf "$T"
