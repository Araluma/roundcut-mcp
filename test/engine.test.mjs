import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { circleCrop, compress, convert, crop, info, resize } from "../dist/engine.js";

const tmp = path.resolve("test/tmp");
await mkdir(tmp, { recursive: true });

/** A 640x400 photo-like gradient with noise, so lossy encoders have work to do. */
async function fixture(name, w = 640, h = 400) {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    raw[i * 3] = (i % w) * 255 / w;
    raw[i * 3 + 1] = Math.floor(i / w) * 255 / h;
    raw[i * 3 + 2] = (i * 7919) % 255;
  }
  const file = path.join(tmp, name);
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toFile(file);
  return file;
}

test("info reads dimensions and format", async () => {
  const f = await fixture("info.jpg");
  const i = await info(f);
  assert.equal(i.format, "jpeg");
  assert.equal(i.width, 640);
  assert.equal(i.height, 400);
  assert.equal(i.hasAlpha, false);
});

test("circle crop is square, transparent in the corners, opaque in the middle", async () => {
  const f = await fixture("circle.jpg");
  const r = await circleCrop(f, { size: 200 });
  assert.equal(r.format, "png");
  assert.equal(r.width, 200);
  assert.equal(r.height, 200);
  const { data, info: meta } = await sharp(r.output).raw().toBuffer({ resolveWithObject: true });
  assert.equal(meta.channels, 4);
  const alphaAt = (x, y) => data[(y * meta.width + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0, "corner must be transparent");
  assert.equal(alphaAt(100, 100), 255, "center must be opaque");
});

test("circle crop to jpeg flattens the corners onto the background", async () => {
  const f = await fixture("circle-jpg.jpg");
  const r = await circleCrop(f, { size: 100, format: "jpeg", background: "#ff0000" });
  assert.equal(r.format, "jpeg");
  const { data } = await sharp(r.output).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 200 && data[1] < 60, "corner pixel should be the red background");
});

test("crop by aspect is centered and exact", async () => {
  const f = await fixture("aspect.jpg");
  const r = await crop(f, { aspect: "1:1" });
  assert.equal(r.width, 400);
  assert.equal(r.height, 400);
});

test("crop by box rejects a box outside the image", async () => {
  const f = await fixture("box.jpg");
  await assert.rejects(crop(f, { left: 600, top: 0, width: 100, height: 100 }), /exceeds/);
});

test("resize keeps aspect and never enlarges by default", async () => {
  const f = await fixture("resize.jpg");
  const small = await resize(f, { width: 320 });
  assert.equal(small.width, 320);
  assert.equal(small.height, 200);
  const same = await resize(f, { width: 5000 });
  assert.equal(same.width, 640, "no upscale without enlarge");
  const big = await resize(f, { width: 1280, enlarge: true });
  assert.equal(big.width, 1280);
});

test("compress keeps the format and shrinks the file", async () => {
  const f = await fixture("compress.jpg");
  const r = await compress(f, { quality: 60 });
  assert.equal(r.format, "jpeg");
  assert.ok(r.bytes < r.inputBytes, `${r.bytes} should be < ${r.inputBytes}`);
  assert.ok(r.output.endsWith("-compressed.jpg"));
});

test("convert to webp and avif, default output path carries the new extension", async () => {
  const f = await fixture("convert.jpg");
  const w = await convert(f, "webp");
  assert.ok(w.output.endsWith("convert.webp"));
  assert.equal((await stat(w.output)).size, w.bytes);
  const a = await convert(f, "avif", { quality: 50 });
  assert.equal(a.format, "avif");
  assert.equal((await sharp(a.output).metadata()).format, "heif");
});

test("missing input fails loudly", async () => {
  await assert.rejects(info(path.join(tmp, "nope.jpg")));
});
