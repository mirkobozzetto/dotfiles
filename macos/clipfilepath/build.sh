#!/usr/bin/env bash
# install.sh only makes symlinks, and a Swift daemon needs a binary.
# Run this once per machine, before loading the LaunchAgent.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p "$HOME/.local/bin"
swiftc -O -o "$HOME/.local/bin/clipfilepath" main.swift
echo "built    $HOME/.local/bin/clipfilepath"
