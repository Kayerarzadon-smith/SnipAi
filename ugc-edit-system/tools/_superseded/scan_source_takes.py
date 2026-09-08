import subprocess, sys, json
from faster_whisper import WhisperModel
SRC = "copy_C33E760E-B4A2-4BF3-98F8-EB53CB6D8A4F.MOV"
WINDOWS = json.loads(sys.argv[1]); WID=float(sys.argv[2]); HOP=float(sys.argv[3])
m = WhisperModel("small.en", device="cpu", compute_type="int8")
for lab, a, b in WINDOWS:
    print(f"### {lab}", flush=True)
    t = a
    while t < b:
        d = min(WID, b - t)
        if d < 0.8: break
        subprocess.run(["ffmpeg","-y","-ss",str(t),"-t",str(d),"-i",SRC,"-vn","-ac","1","-ar","16000",
                        "-c:a","pcm_s16le","/tmp/s3.wav","-loglevel","error","-nostats"],
                       check=True, stdin=subprocess.DEVNULL)
        segs,_ = m.transcribe("/tmp/s3.wav", vad_filter=False, condition_on_previous_text=False)
        print(f"  {t:7.2f}-{t+d:7.2f}: " + " ".join(s.text.strip() for s in segs), flush=True)
        t += HOP
