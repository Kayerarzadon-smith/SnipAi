/**
 * Reading a JSON request body without trusting it to be an object.
 *
 * Every handler here used to do the same thing: `await req.json()` in a try,
 * a 400 in the catch, and then straight into `body.something`. The catch only
 * fires when the text is not JSON -- and `null`, `7`, `"hello"`, `[]` and
 * `true` are all perfectly good JSON. `null.step` throws a TypeError that
 * nothing catches, so the client gets a 500 with a stack trace where it
 * should have got a sentence.
 *
 * Ten routes had it. It is the sort of thing nobody hits by hand and any
 * fuzzer hits immediately.
 */
export async function readJsonObject(
  req: { json(): Promise<unknown> }
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return { ok: false, error: "body must be JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}
