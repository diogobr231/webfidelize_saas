import assert from "node:assert/strict";
import test from "node:test";
import { prepareCompanyCover } from "../src/lib/prepare-company-cover";
import {
  COVER_MAX_BYTES,
  COVER_SOURCE_MAX_BYTES,
} from "../src/lib/company-personalization";

function photo(width = 4000, height = 3000) {
  const bytes = new Uint8Array(32);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], "ambiente.png", { type: "image/png" });
}

test("cover preparation bounds uploads before decoding or allocating a canvas", async () => {
  await assert.rejects(
    prepareCompanyCover(
      new File([new Uint8Array(COVER_SOURCE_MAX_BYTES + 1)], "grande.png", {
        type: "image/png",
      }),
    ),
    /até 10 MB/,
  );
  await assert.rejects(prepareCompanyCover(photo(10000, 10000)), /dimensões/);
});

test("cover preparation uses EXIF orientation and bounds the output on the device", async (t) => {
  const bitmap = {
    width: 3000,
    height: 4000,
    close() {
      closed = true;
    },
  };
  let closed = false;
  let orientation: unknown;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: "", fillRect() {}, drawImage() {} }),
    toBlob(callback: (blob: Blob) => void) {
      callback(new Blob([new Uint8Array(100)], { type: "image/jpeg" }));
    },
  };
  const originalBitmap = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (_file: File, options: unknown) => {
      orientation = options;
      return bitmap;
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => canvas },
  });
  t.after(() => {
    if (originalBitmap)
      Object.defineProperty(globalThis, "createImageBitmap", originalBitmap);
    else Reflect.deleteProperty(globalThis, "createImageBitmap");
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const result = await prepareCompanyCover(photo());
  assert.deepEqual(orientation, { imageOrientation: "from-image" });
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 1600);
  assert.equal(result.type, "image/jpeg");
  assert.ok(result.size <= COVER_MAX_BYTES);
  assert.equal(closed, true);
});

test("cover decoder errors become an actionable Portuguese message", async (t) => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "createImageBitmap",
  );
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async () => {
      throw new Error("InvalidStateError");
    },
  });
  t.after(() =>
    original
      ? Object.defineProperty(globalThis, "createImageBitmap", original)
      : Reflect.deleteProperty(globalThis, "createImageBitmap"),
  );
  await assert.rejects(
    prepareCompanyCover(photo()),
    /Não conseguimos abrir esta foto/,
  );
});
