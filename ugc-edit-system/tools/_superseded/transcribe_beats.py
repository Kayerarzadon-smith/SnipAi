import json, sys, os
lo, hi = int(sys.argv[1]), int(sys.argv[2])
LAB = ["hook-cheeks","hook-eyes","hook-undereyes","product-intro","application","egf-benefit","nad-benefit","collagen-benefit","months-believer","before-5mo","fine-lines","fast-forward","work-done","never-without","dropped","hard-to-get","flash-sale","hit-hard","sale-link","dont-sleep","cta-close"]
OFF = {"hook-cheeks":18.42,"hook-eyes":34.80,"hook-undereyes":47.82,"product-intro":68.96,"application":73.80,"egf-benefit":76.44,"nad-benefit":121.24,"collagen-benefit":125.50,"months-believer":148.00,"before-5mo":153.88,"fine-lines":171.50,"fast-forward":183.52,"work-done":196.00,"never-without":208.00,"dropped":243.50,"hard-to-get":269.00,"flash-sale":276.50,"hit-hard":292.52,"sale-link":299.50,"dont-sleep":312.12,"cta-close":327.50}
from faster_whisper import WhisperModel
m = WhisperModel("small.en", device="cpu", compute_type="int8")
res = {}
p = "/tmp/hires_part.json"
if os.path.exists(p): res = json.load(open(p))
for l in LAB[lo:hi]:
    segs,_ = m.transcribe(f"/tmp/hw/{l}.wav", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    ws=[]
    for sg in segs:
        for w in sg.words:
            ws.append({"w":w.word,"s":round(OFF[l]+w.start,2),"e":round(OFF[l]+w.end,2)})
    res[l]=ws
    print(f"=== {l}", flush=True)
    print("   " + " ".join(f"{w['w'].strip()}[{w['s']:.2f}]" for w in ws), flush=True)
    json.dump(res, open(p,"w"), indent=1)
print("DONE", flush=True)
