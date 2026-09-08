#!/bin/bash
# Builds a tighter cut (v7) aimed at the reference's rhythm, then verifies it.
cd "$(dirname "$0")" || exit 1
source .venv/bin/activate
python3 tools/tune_and_build.py \
  --project projects/medicube-egf-serum \
  --out cuts/glow-up-daddy-medicube-cut-v7.mp4
echo
echo "Done. You can close this window."
