import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { crc32, readZipDirectory, readZipEntry, writeStoredZip, type StoredZipEntry } from "./archive/stored-zip";

async function zipBytes(entries: StoredZipEntry[]) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeStoredZip(entries)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

const text = (value: string) => new TextEncoder().encode(value);

describe("stored zip", () => {
  test("crc32 matches the reference value", () => {
    assert.equal(crc32(text("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array()), 0);
  });

  test("round-trips entries through the central directory", async () => {
    const png = new Uint8Array(70_000).map((_, index) => index % 251);
    const manifest = text(JSON.stringify({ hello: "olá" }));
    const bytes = await zipBytes([
      { data: manifest, name: "manifest.json" },
      { data: png, name: "shots/abc.png" },
      { data: new Uint8Array(), name: "shots/empty.png" },
    ]);
    const archive = new Blob([bytes]);
    const entries = await readZipDirectory(archive);
    assert.deepEqual(entries.map((entry) => [entry.name, entry.size]), [["manifest.json", manifest.byteLength], ["shots/abc.png", 70_000], ["shots/empty.png", 0]]);
    assert.equal(new TextDecoder().decode(await readZipEntry(archive, entries[0])), JSON.stringify({ hello: "olá" }));
    assert.deepEqual(await readZipEntry(archive, entries[1]), png);
  });

  test("rejects a corrupted entry by its checksum", async () => {
    const bytes = await zipBytes([{ data: text("pinar"), name: "a.txt" }]);
    const entries = await readZipDirectory(new Blob([bytes]));
    bytes[30 + "a.txt".length] ^= 0xff;
    await assert.rejects(readZipEntry(new Blob([bytes]), entries[0]), /checksum/);
  });

  test("refuses unsafe or duplicate names and non-zip input", async () => {
    await assert.rejects(zipBytes([{ data: text("x"), name: "../escape" }]), /invalid zip entry name/);
    await assert.rejects(zipBytes([{ data: text("x"), name: "/abs" }]), /invalid zip entry name/);
    await assert.rejects(zipBytes([{ data: text("x"), name: "a" }, { data: text("y"), name: "a" }]), /duplicate/);
    await assert.rejects(readZipDirectory(new Blob([text("not a zip at all")])), /not a zip archive/);
  });

  test("produces an archive that a standard unzip accepts", async (context) => {
    const probe = spawnSync("unzip", ["-v"], { encoding: "utf8", timeout: 10_000 });
    if (probe.status !== 0) {
      context.skip("unzip is not available on this host");
      return;
    }
    const directory = mkdtempSync(join(tmpdir(), "pinar-zip-"));
    const file = join(directory, "export.zip");
    writeFileSync(file, await zipBytes([{ data: text("{}"), name: "manifest.json" }, { data: new Uint8Array([137, 80, 78, 71]), name: "shots/a.png" }]));
    const output = execFileSync("unzip", ["-t", file], { encoding: "utf8", timeout: 10_000 });
    assert.match(output, /No errors detected/);
  });
});
