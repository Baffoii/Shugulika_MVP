/**
 * MediaRecorder WebM output often omits Duration in the EBML Info section.
 * Browsers then guess duration from bitrate/file size (commonly showing values
 * like ~2:30–3:00 for a short clip) and seeking/playback start can look wrong.
 * This rewrites Duration using the known wall-clock recording length.
 */
const EBML_ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  Duration: 0x4489,
  TimecodeScale: 0x2ad7b1,
} as const;

function readVint(view: DataView, offset: number): { value: number; length: number } | null {
  if (offset >= view.byteLength) return null;
  const first = view.getUint8(offset);
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 8 || offset + length > view.byteLength) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + view.getUint8(offset + i);
  }
  return { value, length };
}

function readId(view: DataView, offset: number): { id: number; length: number } | null {
  if (offset >= view.byteLength) return null;
  const first = view.getUint8(offset);
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length += 1;
    mask >>= 1;
  }
  if (length > 4 || offset + length > view.byteLength) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) {
    id = (id << 8) | view.getUint8(offset + i);
  }
  return { id, length };
}

function writeFloat64Be(buffer: Uint8Array, offset: number, value: number) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setFloat64(offset, value, false);
}

/**
 * Returns a Blob with Duration rewritten to `durationSeconds`. Non-WebM blobs
 * (e.g. mp4) are returned unchanged. Failures also return the original blob so
 * recording never blocks on metadata repair.
 */
export async function fixRecordingDuration(blob: Blob, durationSeconds: number): Promise<Blob> {
  if (!blob.type.includes("webm") || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return blob;
  }
  try {
    const source = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    let offset = 0;
    let segmentDataStart = -1;
    let infoStart = -1;
    let infoSize = -1;
    let infoSizeLength = -1;
    let durationOffset = -1;
    let durationSize = -1;
    let timecodeScale = 1_000_000; // WebM default (ns)

    // Walk top-level EBML elements until Segment, then find Info inside it.
    while (offset + 2 < view.byteLength) {
      const id = readId(view, offset);
      if (!id) break;
      offset += id.length;
      const size = readVint(view, offset);
      if (!size) break;
      offset += size.length;
      const dataStart = offset;
      const dataEnd =
        size.value === 0x01ffffffffffffff || size.value >= view.byteLength
          ? view.byteLength
          : Math.min(view.byteLength, dataStart + size.value);

      if (id.id === EBML_ID.Segment) {
        segmentDataStart = dataStart;
        let inner = dataStart;
        while (inner + 2 < dataEnd) {
          const childId = readId(view, inner);
          if (!childId) break;
          inner += childId.length;
          const childSize = readVint(view, inner);
          if (!childSize) break;
          const sizeOffset = inner;
          inner += childSize.length;
          const childDataStart = inner;
          const childDataEnd = Math.min(dataEnd, childDataStart + childSize.value);

          if (childId.id === EBML_ID.Info) {
            infoStart = childDataStart;
            infoSize = childSize.value;
            infoSizeLength = childSize.length;
            // Remember size field start for possible expansion.
            void sizeOffset;
            let infoCursor = childDataStart;
            while (infoCursor + 2 < childDataEnd) {
              const fieldId = readId(view, infoCursor);
              if (!fieldId) break;
              infoCursor += fieldId.length;
              const fieldSize = readVint(view, infoCursor);
              if (!fieldSize) break;
              infoCursor += fieldSize.length;
              if (fieldId.id === EBML_ID.Duration) {
                durationOffset = infoCursor;
                durationSize = fieldSize.value;
              } else if (fieldId.id === EBML_ID.TimecodeScale && fieldSize.value <= 8) {
                let scale = 0;
                for (let i = 0; i < fieldSize.value; i += 1) {
                  scale = scale * 256 + view.getUint8(infoCursor + i);
                }
                if (scale > 0) timecodeScale = scale;
              }
              infoCursor += fieldSize.value;
            }
            break;
          }
          inner = childDataEnd;
        }
        break;
      }
      offset = dataEnd;
    }

    if (segmentDataStart < 0 || infoStart < 0 || infoSize < 0) return blob;

    const durationTicks = (durationSeconds * 1e9) / timecodeScale;

    if (durationOffset >= 0 && durationSize === 8) {
      const patched = source.slice();
      writeFloat64Be(patched, durationOffset, durationTicks);
      return new Blob([patched], { type: blob.type || "video/webm" });
    }

    // Insert a Duration element (id 0x4489, size 0x88 = 8 bytes, float64).
    const durationElement = new Uint8Array(2 + 1 + 8);
    durationElement[0] = 0x44;
    durationElement[1] = 0x89;
    durationElement[2] = 0x88;
    writeFloat64Be(durationElement, 3, durationTicks);

    const beforeInfo = source.slice(0, infoStart);
    const infoData = source.slice(infoStart, infoStart + infoSize);
    const afterInfo = source.slice(infoStart + infoSize);
    const newInfoSize = infoSize + durationElement.length;

    // Rewrite the Info size vint in-place when it still fits the same length.
    const sizeFieldStart = infoStart - infoSizeLength;
    const sizeBytes = new Uint8Array(infoSizeLength);
    // Encode as a fixed-width vint matching the original length.
    let remaining = newInfoSize;
    for (let i = infoSizeLength - 1; i >= 1; i -= 1) {
      sizeBytes[i] = remaining & 0xff;
      remaining >>= 8;
    }
    const lengthMask = 1 << (8 - infoSizeLength);
    if (remaining >= lengthMask) {
      // Size no longer fits original vint width — skip repair rather than
      // reshuffle the whole Segment size chain.
      return blob;
    }
    sizeBytes[0] = lengthMask | remaining;

    const out = new Uint8Array(
      beforeInfo.length + infoData.length + durationElement.length + afterInfo.length,
    );
    out.set(beforeInfo, 0);
    out.set(sizeBytes, sizeFieldStart);
    out.set(infoData, infoStart);
    out.set(durationElement, infoStart + infoSize);
    out.set(afterInfo, infoStart + infoSize + durationElement.length);
    return new Blob([out], { type: blob.type || "video/webm" });
  } catch {
    return blob;
  }
}

/**
 * Clamps displayed / stored recording duration so prep or idle time cannot
 * inflate the response length. Prefers wall-clock start/end when present.
 */
export function resolveRecordingDurationSeconds(input: {
  durationSeconds: number;
  maxDurationSeconds: number;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
}): number {
  const fromClock =
    input.startedAt && input.endedAt
      ? (new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime()) / 1000
      : null;
  const raw =
    fromClock != null && Number.isFinite(fromClock) && fromClock >= 0
      ? fromClock
      : input.durationSeconds;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, input.maxDurationSeconds);
}
