/**
 * Minimal ZIP support for Pinar data exports: entries are *stored* (no
 * compression, method 0), which keeps the code small and is lossless for the
 * PNG screenshots that dominate an export. The writer emits one entry at a
 * time; the reader works from the central directory over anything that can be
 * sliced (a browser File/Blob), so neither side holds the whole archive.
 *
 * ZIP64 is not supported: an archive and every entry must stay below 4 GiB
 * and 65535 entries.
 */

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
const DOS_EPOCH = 0x0021; // 1980-01-01

export interface StoredZipEntry {
  data: Uint8Array;
  name: string;
}

export interface ZipDirectoryEntry {
  crc32: number;
  name: string;
  offset: number;
  size: number;
}

export interface SliceableArchive {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

let crcTable: Uint32Array | null = null;

function table() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array, previous = 0): number {
  const lookup = table();
  let crc = (previous ^ MAX_UINT32) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = lookup[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ MAX_UINT32) >>> 0;
}

function assertEntryName(name: string) {
  if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`invalid zip entry name: ${name}`);
  }
}

/**
 * Streams a stored ZIP. `entries` is consumed lazily, one entry at a time, so
 * a caller can read each screenshot from disk only when it is written.
 */
export async function* writeStoredZip(entries: AsyncIterable<StoredZipEntry> | Iterable<StoredZipEntry>): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const directory: Array<{ crc: number; name: Uint8Array; offset: number; size: number }> = [];
  const names = new Set<string>();
  let offset = 0;
  for await (const entry of entries) {
    assertEntryName(entry.name);
    if (names.has(entry.name)) throw new Error(`duplicate zip entry: ${entry.name}`);
    names.add(entry.name);
    if (directory.length >= MAX_ENTRIES) throw new Error("too many zip entries");
    const name = encoder.encode(entry.name);
    const size = entry.data.byteLength;
    if (size >= MAX_UINT32 || offset + 30 + name.length + size >= MAX_UINT32) throw new Error("zip archive too large");
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, DOS_EPOCH, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    header.set(name, 30);
    directory.push({ crc, name, offset, size });
    yield header;
    if (size) yield entry.data;
    offset += header.length + size;
  }
  const centralStart = offset;
  for (const item of directory) {
    const record = new Uint8Array(46 + item.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, DOS_EPOCH, true);
    view.setUint32(16, item.crc, true);
    view.setUint32(20, item.size, true);
    view.setUint32(24, item.size, true);
    view.setUint16(28, item.name.length, true);
    view.setUint32(42, item.offset, true);
    record.set(item.name, 46);
    yield record;
    offset += record.length;
  }
  if (offset >= MAX_UINT32) throw new Error("zip archive too large");
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(8, directory.length, true);
  view.setUint16(10, directory.length, true);
  view.setUint32(12, offset - centralStart, true);
  view.setUint32(16, centralStart, true);
  yield end;
}

async function bytesAt(archive: SliceableArchive, start: number, end: number) {
  return new Uint8Array(await archive.slice(start, end).arrayBuffer());
}

/** Reads the central directory of a stored ZIP (no ZIP64, no compression). */
export async function readZipDirectory(archive: SliceableArchive): Promise<ZipDirectoryEntry[]> {
  const tailSize = Math.min(archive.size, 22 + 0xffff);
  const tail = await bytesAt(archive, archive.size - tailSize, archive.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tailView.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = tailView.getUint16(eocd + 10, true);
  const directorySize = tailView.getUint32(eocd + 12, true);
  const directoryOffset = tailView.getUint32(eocd + 16, true);
  if (directoryOffset + directorySize > archive.size) throw new Error("corrupt zip directory");
  const directory = await bytesAt(archive, directoryOffset, directoryOffset + directorySize);
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  const entries: ZipDirectoryEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directory.length || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER) throw new Error("corrupt zip directory");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (method !== 0 || compressedSize !== size) throw new Error("only stored zip entries are supported");
    const name = decoder.decode(directory.subarray(cursor + 46, cursor + 46 + nameLength));
    assertEntryName(name);
    entries.push({ crc32: view.getUint32(cursor + 16, true), name, offset: view.getUint32(cursor + 42, true), size });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reads one stored entry and checks its CRC-32. */
export async function readZipEntry(archive: SliceableArchive, entry: ZipDirectoryEntry): Promise<Uint8Array> {
  const header = await bytesAt(archive, entry.offset, entry.offset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER) throw new Error(`corrupt zip entry: ${entry.name}`);
  const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  if (start + entry.size > archive.size) throw new Error(`corrupt zip entry: ${entry.name}`);
  const data = await bytesAt(archive, start, start + entry.size);
  if (crc32(data) !== entry.crc32) throw new Error(`zip entry failed its checksum: ${entry.name}`);
  return data;
}
