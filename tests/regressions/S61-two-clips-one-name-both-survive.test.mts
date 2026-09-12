import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { scratchDir } from "../scratch.mts";

/**
 * LEDGER S61 -- two dropped clips whose names resolve to the same staged
 * path overwrote each other, and both rows reported `✓ copied`.
 *
 * `safeFileName` reduces every name to a basename, so `stagedPath` returned
 * the same destination and the second upload streamed over the first.
 * `recordStagedFile` deduped by that same name, so `b.files` ended with one
 * entry. `DropZone` deduped its queue by the ORIGINAL name plus size, so both
 * clips queued, both uploaded, both were marked copied, and the route
 * answered 201 twice. Five clips in, the head count said five, and the lost
 * one was never mentioned.
 *
 * THE REALISTIC TRIGGER NEEDS NO SANITISATION AT ALL, and that is what this
 * file is built against: the file picker hands over basenames, so
 * `A/IMG_0060.MOV` and `B/IMG_0060.MOV` are indistinguishable by the time the
 * route sees them. He shoots on a phone where `IMG_` numbering recycles
 * across folders and albums. No odd characters required.
 *
 * WHAT THIS FILE ASSERTS. Not that `safeFileName` collides -- that tests the
 * function, and the function is doing its job. The claim is the observable
 * one from the row's exit:
 *
 *     two files in, two files staged, and `b.files` agrees with the disk
 *
 * WHICH FIX, AND WHY THIS ONE. A refusal naming the collision was the other
 * defensible option. Staging beside won because nothing is lost either way
 * and a refusal would send him to Finder to rename his own footage for
 * something the app can handle without losing a byte -- and because his
 * standing preference, "propose, do not decide", is about judgements over his
 * content, not about where a file lands. He is told: the tray row says
 * another clip already had that name and what this one was kept as, so the
 * decision is visible rather than silent. The count matching the disk is the
 * primary clause of the exit; being told is the second.
 */

const LIB = scratchDir("s61");
fs.mkdirSync(path.join(LIB, "projects"), { recursive: true });
fs.mkdirSync(path.join(LIB, "state"), { recursive: true });
process.env.SNIPAI_DATA = LIB;

const {
  createBatch, readBatch, stagedPath, stagedNameFor, recordStagedFile, safeFileName,
} = await import("@/lib/importBatch");
const { POST } = await import("@/app/api/import/[batch]/files/route");

/** Upload bytes the way the tray does: the name travels in a header. */
async function upload(batch: string, filename: string, bytes: Uint8Array) {
  const res = await POST(
    new Request(`http://127.0.0.1:4737/api/import/${batch}/files`, {
      method: "POST",
      headers: {
        "x-snipai-filename": encodeURIComponent(filename),
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length),
      },
      body: bytes,
      // @ts-expect-error -- undici needs this for a streaming body
      duplex: "half",
    }) as never,
    { params: { batch } }
  );
  const body = (await res.json()) as {
    file?: string; takenAs?: string | null; droppedAs?: string; files?: number; error?: string;
  };
  return { status: res.status, body };
}

function clipsOnDisk(id: string): string[] {
  const d = path.join(LIB, ".staging", id, "clips");
  return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

/* ---------------------------------------------------------------- the harm */

test("S61: two clips from different folders with one name both survive", async () => {
  /* The row's realistic case, and the whole claim: two files in, two staged,
     and the record agreeing with the disk. */
  const b = createBatch();
  const first = await upload(b.id, "A/IMG_0060.MOV", bytes(4096, 1));
  const second = await upload(b.id, "B/IMG_0060.MOV", bytes(8192, 2));

  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const onDisk = clipsOnDisk(b.id);
  assert.equal(onDisk.length, 2, `two clips were dropped and ${onDisk.length} are on disk: ${JSON.stringify(onDisk)}`);

  const recorded = readBatch(b.id)!.files;
  assert.equal(recorded.length, 2, `the record holds ${recorded.length} of the 2 clips`);
  assert.deepEqual(
    recorded.map((f) => f.name).sort(), onDisk,
    "the record and the disk disagree about what was staged"
  );

  /* Neither is the other: the second did not stream over the first. */
  const sizes = recorded.map((f) => f.sizeBytes).sort((x, y) => x - y);
  assert.deepEqual(sizes, [4096, 8192], "one clip's bytes replaced the other's");
});

test("S61: and he is told, rather than his footage being quietly renamed", async () => {
  const b = createBatch();
  await upload(b.id, "A/IMG_0060.MOV", bytes(4096, 1));
  const second = await upload(b.id, "B/IMG_0060.MOV", bytes(8192, 2));

  assert.ok(second.body.takenAs, "the collision was resolved silently");
  assert.equal(second.body.file, second.body.takenAs, "the response names a file it did not stage");
  assert.equal(second.body.droppedAs, "IMG_0060.MOV", "the response does not say what he dropped");
  /* And the record keeps what he dropped, so the tray can say it later. */
  const kept = readBatch(b.id)!.files.find((f) => f.name === second.body.takenAs);
  assert.equal(kept?.originalName, "B/IMG_0060.MOV", "the original name was not kept alongside");
});

/* ------------------------------------------------ the dangerous directions */

test("S61: the same clip sent twice is still one clip", async () => {
  /* The direction that would be a different bug: an upload retried into the
     same batch has to stay idempotent, which is what the client's own queue
     dedupe already assumes. Same name AND same size is the same clip. */
  const b = createBatch();
  await upload(b.id, "IMG_0060.MOV", bytes(4096, 1));
  const again = await upload(b.id, "IMG_0060.MOV", bytes(4096, 1));

  assert.equal(again.body.takenAs, null, "a re-sent clip was staged a second time");
  assert.deepEqual(clipsOnDisk(b.id), ["IMG_0060.MOV"]);
  assert.equal(readBatch(b.id)!.files.length, 1, "a retry produced two records");
});

test("S61: disambiguating a name does not move the clip in the filmed order", async () => {
  /* `lib/stitch.ts`'s `filenameNumber` reads the TRAILING number of a name to
     order a roll when the capture stamps are missing. So `IMG_0060-2.MOV`
     would read as 2 and sort ahead of `IMG_0060.MOV` -- quietly reordering
     his video to fix a filename clash. The disambiguator is a prefix for that
     reason, and this is where the reason is held. */
  const b = createBatch();
  await upload(b.id, "IMG_0060.MOV", bytes(4096, 1));
  const second = await upload(b.id, "other/IMG_0060.MOV", bytes(8192, 2));

  const trailing = (n: string) => {
    const stem = n.replace(/\.[^.]*$/, "");
    const m = /(\d+)\s*$/.exec(stem);
    return m ? Number(m[1]) : null;
  };
  assert.equal(
    trailing(second.body.file!), trailing("IMG_0060.MOV"),
    `${second.body.file} orders as ${trailing(second.body.file!)} where IMG_0060.MOV orders as ` +
    `${trailing("IMG_0060.MOV")} -- the filename fallback would reorder his clips`
  );
});

test("S61: three clips with one name all survive, in a stable order", async () => {
  const b = createBatch();
  const names: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await upload(b.id, `folder${i}/IMG_0060.MOV`, bytes(1024 * (i + 1), i));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    names.push(r.body.file!);
  }
  assert.equal(new Set(names).size, 3, `three clips were staged as ${JSON.stringify(names)}`);
  assert.equal(clipsOnDisk(b.id).length, 3);
  assert.equal(readBatch(b.id)!.files.length, 3);
});

test("S61: a file already on disk with no record is not overwritten either", async () => {
  /* This row's own aftermath: an overwrite left a file with no entry beside
     it. A resolver that only consulted the record would stream straight over
     it again. */
  const b = createBatch();
  const orphan = stagedPath(b.id, "IMG_0099.MOV");
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, "an earlier upload nobody recorded");

  const r = await upload(b.id, "IMG_0099.MOV", bytes(2048, 9));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.takenAs, "an unrecorded file on disk was overwritten");
  assert.equal(
    fs.readFileSync(orphan, "utf8"), "an earlier upload nobody recorded",
    "the unrecorded file's bytes were replaced"
  );
});

/* ------------------------------------------------------------- the resolver */

test("S61: the resolver leaves an ordinary clip completely alone", () => {
  const b = createBatch();
  const r = stagedNameFor(b.id, "IMG_1234.MOV", 4096);
  assert.deepEqual(r, { name: "IMG_1234.MOV", takenAs: null });
  /* And an ordinary record carries no extra field for the tray to explain. */
  recordStagedFile(b.id, "IMG_1234.MOV", 4096, "IMG_1234.MOV");
  assert.equal(readBatch(b.id)!.files[0].originalName, undefined);
});

test("S61: sanitisation still collapses odd characters, and that still collides safely", () => {
  /* The case the row was originally filed on. It is the rarer trigger, but it
     must not regress: two different names reducing to one safe name are two
     clips, not one. */
  const b = createBatch();
  /* Two genuinely different names that reduce to one safe name -- checked
     here, because the first pair I reached for did NOT collide and the test
     passed for the wrong reason until it was asserted. */
  assert.equal(safeFileName("my clip!.MOV"), "my_clip_.MOV");
  assert.equal(safeFileName("my+clip?.MOV"), "my_clip_.MOV");

  const a = stagedNameFor(b.id, "my clip!.MOV", 100);
  recordStagedFile(b.id, a.name, 100, "my clip!.MOV");
  const c = stagedNameFor(b.id, "my+clip?.MOV", 200);
  assert.notEqual(c.name, a.name, "two different clips resolved to one staged name");
  assert.ok(c.takenAs, "the second was not reported as renamed");
});
