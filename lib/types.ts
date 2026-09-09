export type Beat = {
  label: string;
  start: number;
  end: number;
  text?: string;
  /** Detached audio. When present the sound comes from this range instead of
   * start/end -- a J-cut (audio leads the picture) or L-cut (audio trails it).
   * Absent means the audio is locked to the picture, so an ordinary beat
   * carries no extra fields. */
  audioStart?: number;
  audioEnd?: number;
  /** Seconds of fade at each edge. Audio ramps and the picture dips with it,
   * which is what stops a hard join sounding like a click. */
  fadeIn?: number;
  fadeOut?: number;
  /** Stretches removed from INSIDE the line, in source seconds. Cutting a bit
   * out of the middle of a take used to split the beat in two, which left two
   * rows saying the same line. It is one line with a piece taken out, so it
   * stays one beat and the picture either side butts together. */
  holes?: [number, number][];
};

export type BeatsFile = {
  source: string;
  notes?: string;
  beats: Beat[];
};

export type CutStatus = "unreviewed" | "approved" | "needs_fixes" | "trashed";

export type BeatDiagnosis = {
  checks: string[];
  note: string;
  fix?: string;
  answeredAt: string;
};

export type TimelineMarker = {
  atPct: number;
  createdAt: string;
};

export type ReviewState = {
  /** Set only when the file on disk could not be read and was moved aside.
   *  Present so the UI can say so instead of showing an empty review. */
  stateProblem?: string;
  project: string;
  cutStatus: CutStatus;
  cutFile?: string;
  statusNote?: string;
  updatedAt: string;
  timelineMarkers: TimelineMarker[];
  beatDiagnoses: Record<string, BeatDiagnosis>;
  takePicks: Record<string, { chosenId: string; pickedAt: string }>;
  candidateCache: Record<string, CandidateTakesResult>;
  /** Every manual trim, kept as training data. Consistent movement in one
   * direction means the snap defaults are wrong, and by how much. */
  trimEdits?: {
    beatLabel: string;
    startDelta: number;
    endDelta: number;
    at: string;
  }[];
  /** Stretches cut out of the middle of a line. The most teachable edit
   * there is: what was in it says what should have been dropped already. */
  cutRegions?: {
    beatLabel: string;
    from: number;
    to: number;
    seconds: number;
    /** what was said inside it, if anything */
    words: string[];
    /** share of the region that was below the silence floor */
    silenceRatio: number;
    at: string;
  }[];
  /** Lines dropped from the cut. Kept because "this take wasn't worth
   * keeping" is a judgement the scorer should eventually predict. */
  deletedBeats?: {
    label: string;
    text?: string;
    start: number;
    end: number;
    at: string;
  }[];
  /** Results of verify_cut.py / compare_to_reference.py, cached against the
   * cut they were computed for. These run Whisper over the whole cut, which
   * is far too slow to do during a page load. */
  checks?: {
    cutFile: string;
    computedAt: string;
    metrics: ScorecardMetric[];
  };
};

export type CandidateTake = {
  id: string;
  start: number;
  end: number;
  jumpCut?: { start: number; end: number }[];
  text: string;
  confidence: number;
  flags: string[];
  why: { ok: boolean; label: string }[];
};

export type CandidateTakesResult = {
  region: { start: number; end: number };
  candidates: CandidateTake[];
  recommendedId: string | null;
};

export type ScorecardMetric = {
  key: string;
  label: string;
  value: number | null; // 0-100, null = not computable yet
  note: string;
};

export type Scorecard = {
  overall: number | null;
  metrics: ScorecardMetric[];
};

export type LearningPreference = {
  id: string;
  category: "take-selection" | "cutting-rules" | "pacing" | "other";
  text: string;
  active: boolean;
  source: "seed" | "captured";
  createdAt: string;
};

export type PlatformConnection = {
  id: string;
  label: string;
  status: "not_connected";
};

export type PipelineAvailability = {
  python3: boolean;
  ffmpeg: boolean;
  fasterWhisper: boolean;
};
