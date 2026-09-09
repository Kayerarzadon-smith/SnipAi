import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./paths";

/**
 * Turning a frame of your own footage into a new one.
 *
 * SnipAi composites; it does not generate. This is the one place that talks to
 * something that does. Everything either side of it -- pulling the frame,
 * freezing it, laying the result back over the cut, the sound on the join --
 * is ours and works without a provider. What is behind this file is a single
 * call, so which provider is a setting rather than a rewrite.
 *
 * The job is image-to-image EDITING, not generation: the point is that it is
 * still recognisably his neck. A model that invents a good neck has failed.
 */

export type Provider = "bfl" | "gemini" | "openai";

export type GenResult =
  | { ok: true; bytes: Buffer; provider: Provider; costNote: string }
  | { ok: false; error: string; needsKey?: boolean };

type Creds = { provider: Provider; key: string };

const KEYS_FILE = path.join(STATE_ROOT, "providers.json");

/**
 * The key, from the environment or the file the Settings screen writes.
 *
 * Never from the client, never logged, and never written into a project --
 * projects get handed around and a key in one is a key in someone else's
 * hands. It stays in the library's state directory, which is yours.
 */
export function credentials(): Creds | null {
  const env: [Provider, string | undefined][] = [
    ["bfl", process.env.BFL_API_KEY],
    ["gemini", process.env.GEMINI_API_KEY],
    ["openai", process.env.OPENAI_API_KEY],
  ];
  for (const [provider, key] of env) {
    if (key && key.trim()) return { provider, key: key.trim() };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")) as {
      provider?: Provider; key?: string;
    };
    if (saved.provider && saved.key) return { provider: saved.provider, key: saved.key };
  } catch {
    /* nothing configured, which is a state not an error */
  }
  return null;
}

export function isConfigured(): boolean {
  return credentials() !== null;
}

/** What a shot will cost, roughly, so it is on screen before you press go. */
export const COST: Record<Provider, string> = {
  bfl: "about 4c a shot",
  gemini: "about 4c a shot",
  openai: "2c to 19c a shot, by size and quality",
};

export const PROVIDER_NAME: Record<Provider, string> = {
  bfl: "FLUX.1 Kontext",
  gemini: "Gemini Flash Image",
  openai: "OpenAI gpt-image-1",
};

/**
 * Edit one frame.
 *
 * `frame` is a PNG pulled straight out of the footage. `instruction` is what
 * should change and, just as importantly, what should not.
 */
export async function editFrame(
  frame: Buffer,
  instruction: string,
  opts: { timeoutMs?: number } = {}
): Promise<GenResult> {
  const creds = credentials();
  if (!creds) {
    return {
      ok: false,
      needsKey: true,
      error: "No image provider is set up. Settings → Pipeline, or set BFL_API_KEY, " +
             "GEMINI_API_KEY or OPENAI_API_KEY before starting the app.",
    };
  }

  // The instruction carries the constraint as well as the change: these models
  // will happily give back a better-looking stranger otherwise.
  const prompt =
    `${instruction.trim()}. Keep everything else in the photograph exactly as it is — ` +
    `the same person, the same face, the same clothing, the same lighting, the same ` +
    `background and the same framing. Photographic, not illustrated.`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
  try {
    switch (creds.provider) {
      case "gemini":  return await viaGemini(frame, prompt, creds.key, ctl.signal);
      case "openai":  return await viaOpenAI(frame, prompt, creds.key, ctl.signal);
      case "bfl":     return await viaBfl(frame, prompt, creds.key, ctl.signal);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /abort/i.test(msg) ? "the provider took too long" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- the three, each reduced to one call --------------------------------
   Different shapes, same contract: bytes in, bytes out, or a reason. */

async function viaGemini(
  frame: Buffer, prompt: string, key: string, signal: AbortSignal
): Promise<GenResult> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.5-flash-image:generateContent",
    {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/png", data: frame.toString("base64") } },
          ],
        }],
      }),
    }
  );
  if (!res.ok) return { ok: false, error: `Gemini: ${res.status} ${await res.text().then(t => t.slice(0, 200))}` };
  const body = await res.json() as {
    candidates?: { content?: { parts?: { inline_data?: { data?: string };
                                         inlineData?: { data?: string } }[] } }[];
  };
  const part = body.candidates?.[0]?.content?.parts
    ?.find((p) => p.inline_data?.data || p.inlineData?.data);
  const b64 = part?.inline_data?.data ?? part?.inlineData?.data;
  if (!b64) return { ok: false, error: "Gemini returned no image" };
  return { ok: true, bytes: Buffer.from(b64, "base64"), provider: "gemini", costNote: COST.gemini };
}

async function viaOpenAI(
  frame: Buffer, prompt: string, key: string, signal: AbortSignal
): Promise<GenResult> {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", prompt);
  form.append("image", new Blob([new Uint8Array(frame)], { type: "image/png" }), "frame.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", signal, headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  if (!res.ok) return { ok: false, error: `OpenAI: ${res.status} ${await res.text().then(t => t.slice(0, 200))}` };
  const body = await res.json() as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) return { ok: false, error: "OpenAI returned no image" };
  return { ok: true, bytes: Buffer.from(b64, "base64"), provider: "openai", costNote: COST.openai };
}

async function viaBfl(
  frame: Buffer, prompt: string, key: string, signal: AbortSignal
): Promise<GenResult> {
  const start = await fetch("https://api.bfl.ai/v1/flux-kontext-pro", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-key": key },
    body: JSON.stringify({ prompt, input_image: frame.toString("base64"), output_format: "png" }),
  });
  if (!start.ok) return { ok: false, error: `BFL: ${start.status} ${await start.text().then(t => t.slice(0, 200))}` };
  const { polling_url } = await start.json() as { polling_url?: string };
  if (!polling_url) return { ok: false, error: "BFL gave no polling url" };

  // BFL is asynchronous: a few seconds, polled, rather than one long request
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetch(polling_url, { signal, headers: { "x-key": key } });
    if (!poll.ok) continue;
    const p = await poll.json() as { status?: string; result?: { sample?: string } };
    if (p.status === "Ready" && p.result?.sample) {
      const img = await fetch(p.result.sample, { signal });
      if (!img.ok) return { ok: false, error: "BFL image could not be fetched" };
      return {
        ok: true, bytes: Buffer.from(await img.arrayBuffer()),
        provider: "bfl", costNote: COST.bfl,
      };
    }
    if (p.status && !/pending|queue|processing|ready/i.test(p.status)) {
      return { ok: false, error: `BFL: ${p.status}` };
    }
  }
  return { ok: false, error: "BFL did not finish in a minute" };
}
