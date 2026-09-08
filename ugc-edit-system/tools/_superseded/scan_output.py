import subprocess, sys
from faster_whisper import WhisperModel
SRC = sys.argv[1]; DUR = float(sys.argv[2]); a=float(sys.argv[3]); b=float(sys.argv[4])
m = WhisperModel("small.en", device="cpu", compute_type="int8")
t = a
while t < min(b, DUR):
    d = min(5.0, DUR - t)
    subprocess.run(["ffmpeg","-y","-ss",str(t),"-t",str(d),"-i",SRC,"-vn","-ac","1","-ar","16000",
                    "-c:a","pcm_s16le","/tmp/scan.wav","-loglevel","error","-nostats"],
                   check=True, stdin=subprocess.DEVNULL)
    segs,_ = m.transcribe("/tmp/scan.wav", vad_filter=False, condition_on_previous_text=False)
    txt = " ".join(s.text.strip() for s in segs)
    print(f"{t:6.1f}-{t+d:5.1f}: {txt}", flush=True)
    t += 4.0
