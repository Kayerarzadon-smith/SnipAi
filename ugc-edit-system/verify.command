#!/bin/bash
# Proves the pipeline works: transcribes the finished cut and checks for repeated phrases.
cd "$(dirname "$0")" || exit 1
source .venv/bin/activate
echo "Checking the v6 cut. The first run downloads the speech model, so give it a minute."
echo
python3 tools/verify_cut.py projects/medicube-egf-serum/cuts/glow-up-daddy-medicube-cut-v6.mp4
echo
echo "Done. You can close this window."
