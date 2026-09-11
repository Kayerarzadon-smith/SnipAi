/**
 * What counts as footage, in one place.
 *
 * It was written out three times -- the importer took six containers, the
 * reference uploader took four, and the drop tray had its own regex -- so the
 * same .avi was "a video" on the Queue and "isn't a video" in Settings. QA
 * found it from the outside and said exactly that. Nothing about a reference
 * needs a narrower list than footage: neither screen plays the file back, and
 * both measure it with ffmpeg, which reads all six.
 *
 * The desktop file chooser needs the same list in Swift, where it cannot see
 * this file; scripts/guard-open-panel.py fails the build if the two drift.
 */
export const VIDEO_EXT_LIST = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];

export const VIDEO_EXT = new RegExp(
  `(${VIDEO_EXT_LIST.join("|").replace(/\./g, "\\.")})$`,
  "i"
);

export function isVideoName(name: string): boolean {
  return VIDEO_EXT.test(name);
}

/**
 * "IMG_9817.MOV" -> "img-9817", the project a file would be imported as.
 *
 * Lives here rather than in the drop tray because the tray is no longer the
 * only thing that needs it: a proposed GROUP of clips is named after its
 * first clip, and the name has to be the same one the import would produce or
 * the tray is showing him something that will not happen (DOCKET M0.8).
 */
export function projectNameFor(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled"
  );
}

/** "…: .mov, .mp4, .m4v, .avi, .mkv or .webm" -- for saying what is accepted. */
export function acceptedList(): string {
  const l = VIDEO_EXT_LIST;
  return `${l.slice(0, -1).join(", ")} or ${l[l.length - 1]}`;
}
