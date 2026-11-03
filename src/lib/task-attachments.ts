// What may be attached to a task, and how it is served back.
//
// Files live as bytea in the row — the same decision as QuotationDocument,
// for the same reason: this app has no object storage and no persistent disk
// (local now, a VPS later), so a file written to disk is the one thing a
// redeploy loses. That is only reasonable while the rows stay small, which is
// what the limits below are for.

/**
 * 5 MB per file.
 *
 * A phone photo of a cracked mould is 2-4 MB, which is the actual use case.
 * Postgres will happily store 50 MB in a row and then every query that
 * touches the table drags it around, so the ceiling is deliberate rather
 * than generous.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Per task, so one task cannot become a 100 MB row set on its own. */
export const MAX_ATTACHMENTS_PER_TASK = 10;

/**
 * An allow-list, never a block-list.
 *
 * The file is served back to a browser, so the type decides what the browser
 * will do with it. Anything that can execute in the page's origin — HTML,
 * SVG (which carries <script>), XML — is refused outright rather than served
 * with hopeful headers. A block-list would have to anticipate every such
 * type; an allow-list only has to name the ones the factory needs.
 */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

export type AttachmentProblem = string | null;

/**
 * Why this file may not be attached, or null if it may.
 *
 * Returns the message rather than throwing, so the same rule can drive the
 * form's inline error and the server action's refusal from one place.
 */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  existingCount: number
): AttachmentProblem {
  if (existingCount >= MAX_ATTACHMENTS_PER_TASK) {
    return `A task can hold ${MAX_ATTACHMENTS_PER_TASK} files. Remove one first.`;
  }
  if (!file.size) return "That file is empty.";
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `${formatBytes(file.size)} is too big — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`;
  }
  if (!ALLOWED_ATTACHMENT_TYPES[file.type]) {
    return `${file.type || "That file type"} is not allowed. Photos, PDFs, text and spreadsheets only.`;
  }
  if (!safeFileName(file.name)) return "That file needs a name.";
  return null;
}

/**
 * A filename safe to put in a Content-Disposition header and show on screen.
 *
 * Strips any path (a browser can send "../../etc/passwd" as a name), control
 * characters, and the quotes and semicolons that would break out of the
 * header's quoted-string. Returns "" when nothing usable is left, which the
 * caller treats as invalid rather than silently inventing a name.
 */
export function safeFileName(raw: string): string {
  const base = (raw ?? "")
    // Path separators first — both kinds, since the client may be Windows.
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["\\;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Leading dots would hide the file and ".." is not a name.
  const cleaned = base.replace(/^\.+/, "").trim();
  return cleaned.slice(0, 120);
}

/** Human size, for the limit messages and the file list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Whether this type can be shown inline, or must be forced as a download.
 *
 * Only the raster image types and PDF are ever shown inline. Everything else
 * — including text/plain and CSV, which a browser will render in the page —
 * is sent as an attachment, so a file whose bytes happen to contain markup
 * cannot execute in the app's origin even if its declared type was wrong.
 */
export function isInlineSafe(mimeType: string): boolean {
  return (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/webp" ||
    mimeType === "application/pdf"
  );
}
