/**
 * Pure image operations on top of sharp. No MCP here: every function takes a
 * path, returns a small report, and is unit-tested directly. The MCP layer
 * (index.ts) only adapts these to tool calls.
 */
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type Region, type Sharp } from "sharp";

export type Format = "jpeg" | "png" | "webp" | "avif";
export const FORMATS = ["jpeg", "png", "webp", "avif"] as const;
const EXT: Record<Format, string> = { jpeg: ".jpg", png: ".png", webp: ".webp", avif: ".avif" };

/** Pixel ceiling per image. 80 MP covers every phone camera; beyond that sharp
 *  would happily allocate gigabytes for a single call issued by an LLM. */
const MAX_PIXELS = 80_000_000;

export interface Report {
  output: string;
  format: Format;
  width: number;
  height: number;
  bytes: number;
  inputBytes: number;
}

export async function readInput(input: string): Promise<{ buf: Buffer; bytes: number; abs: string }> {
  const abs = path.resolve(input);
  await access(abs);
  const s = await stat(abs);
  if (!s.isFile()) throw new Error(`not a file: ${abs}`);
  return { buf: await readFile(abs), bytes: s.size, abs };
}

function open(buf: Buffer): Sharp {
  return sharp(buf, { limitInputPixels: MAX_PIXELS, failOn: "error" });
}

export function formatOf(meta: Metadata): Format {
  const f = meta.format;
  if (f === "jpeg" || f === "png" || f === "webp") return f;
  // sharp reports AVIF as heif + av1 compression; HEIC is heif + hevc.
  if (f === "heif" && meta.compression === "av1") return "avif";
  // HEIC, TIFF, GIF, SVG decode fine but have no matching web encoder: use PNG.
  return "png";
}

/** Default output path: same directory, same stem, a suffix, the target extension. */
export function outputPathFor(inputAbs: string, suffix: string, format: Format, explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const dir = path.dirname(inputAbs);
  const stem = path.basename(inputAbs, path.extname(inputAbs));
  return path.join(dir, `${stem}${suffix}${EXT[format]}`);
}

export interface EncodeOptions {
  /** 1..100 for the lossy formats; png ignores it. Default 80. */
  quality?: number;
  /** CSS color used to flatten alpha when the output is jpeg. Default white. */
  background?: string;
}

/** Apply the output encoder. jpeg has no alpha, so transparent pixels are
 *  flattened onto `background` instead of turning black. */
export function encode(img: Sharp, format: Format, opts: EncodeOptions = {}): Sharp {
  const q = opts.quality ?? 80;
  switch (format) {
    case "jpeg":
      return img.flatten({ background: opts.background ?? "#ffffff" }).jpeg({ quality: q, mozjpeg: true });
    case "png":
      return img.png({ compressionLevel: 9, effort: 7 });
    case "webp":
      return img.webp({ quality: q });
    case "avif":
      return img.avif({ quality: q, effort: 4 });
  }
}

async function finish(img: Sharp, format: Format, opts: EncodeOptions, output: string, inputBytes: number): Promise<Report> {
  const { data, info } = await encode(img, format, opts).toBuffer({ resolveWithObject: true });
  await writeFile(output, data);
  return { output, format, width: info.width, height: info.height, bytes: data.length, inputBytes };
}

export async function info(input: string) {
  const { buf, bytes, abs } = await readInput(input);
  const m = await open(buf).metadata();
  return {
    path: abs,
    bytes,
    format: m.format,
    width: m.width,
    height: m.height,
    hasAlpha: m.hasAlpha ?? false,
    orientation: m.orientation ?? 1,
    space: m.space,
  };
}

export interface CircleCropOptions extends EncodeOptions {
  output?: string;
  /** Default png, which keeps the transparent corners. */
  format?: Format;
  /** Output side in px. Default: the largest centered square of the input. */
  size?: number;
}

/** Center square, then a circular alpha mask. png/webp/avif keep the
 *  transparency; jpeg gets the corners flattened onto `background`. */
export async function circleCrop(input: string, o: CircleCropOptions = {}): Promise<Report> {
  const { buf, bytes, abs } = await readInput(input);
  const format = o.format ?? "png";
  const base = open(buf).rotate();
  const m = await base.metadata();
  const side = Math.min(m.width ?? 0, m.height ?? 0);
  if (!side) throw new Error("could not read image dimensions");
  const size = o.size ?? side;
  const r = size / 2;
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  // sharp applies composite LAST in its pipeline, after flatten: masking and
  // jpeg-flattening in one pass would flatten first and leave the corners
  // transparent, which jpeg then paints black. Two passes keep the order honest.
  const masked = await base
    .resize(size, size, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  return finish(open(masked), format, o, outputPathFor(abs, "-circle", format, o.output), bytes);
}

export interface CropOptions extends EncodeOptions {
  output?: string;
  format?: Format;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  /** "1:1", "16:9", "4:5": a centered crop to that ratio, overriding the pixel box. */
  aspect?: string;
}

export async function crop(input: string, o: CropOptions = {}): Promise<Report> {
  const { buf, bytes, abs } = await readInput(input);
  const base = open(buf).rotate();
  const m = await base.metadata();
  const W = m.width ?? 0;
  const H = m.height ?? 0;
  const format = o.format ?? formatOf(m);
  let region: Region;
  if (o.aspect) {
    const [aw, ah] = o.aspect.split(":").map(Number);
    if (!aw || !ah) throw new Error(`bad aspect "${o.aspect}", expected like 16:9`);
    let w = W;
    let h = Math.round((W * ah) / aw);
    if (h > H) {
      h = H;
      w = Math.round((H * aw) / ah);
    }
    region = { left: Math.floor((W - w) / 2), top: Math.floor((H - h) / 2), width: w, height: h };
  } else {
    const { left = 0, top = 0, width, height } = o;
    if (!width || !height) throw new Error("crop needs width and height, or an aspect");
    if (left + width > W || top + height > H) throw new Error(`crop box exceeds the ${W}x${H} image`);
    region = { left, top, width, height };
  }
  return finish(base.extract(region), format, o, outputPathFor(abs, "-crop", format, o.output), bytes);
}

export interface ResizeOptions extends EncodeOptions {
  output?: string;
  format?: Format;
  width?: number;
  height?: number;
  /** 1..400, relative to the input size. */
  percent?: number;
  /** Default inside: keeps the aspect ratio and never crops. */
  fit?: "inside" | "cover" | "fill";
  /** Default false: never upscale. */
  enlarge?: boolean;
}

export async function resize(input: string, o: ResizeOptions = {}): Promise<Report> {
  const { buf, bytes, abs } = await readInput(input);
  const base = open(buf).rotate();
  const m = await base.metadata();
  const format = o.format ?? formatOf(m);
  let width = o.width;
  let height = o.height;
  if (o.percent) {
    width = Math.round(((m.width ?? 0) * o.percent) / 100);
    height = Math.round(((m.height ?? 0) * o.percent) / 100);
  }
  if (!width && !height) throw new Error("resize needs width, height or percent");
  const img = base.resize({
    width,
    height,
    fit: o.fit ?? "inside",
    kernel: "lanczos3",
    withoutEnlargement: !(o.enlarge ?? false),
  });
  return finish(img, format, o, outputPathFor(abs, "-resized", format, o.output), bytes);
}

export interface CompressOptions extends EncodeOptions {
  output?: string;
}

/** Same format in and out, smaller file. png is lossless; the others use `quality`. */
export async function compress(input: string, o: CompressOptions = {}): Promise<Report> {
  const { buf, bytes, abs } = await readInput(input);
  const base = open(buf).rotate();
  const format = formatOf(await base.metadata());
  return finish(base, format, o, outputPathFor(abs, "-compressed", format, o.output), bytes);
}

export interface ConvertOptions extends EncodeOptions {
  output?: string;
}

export async function convert(input: string, format: Format, o: ConvertOptions = {}): Promise<Report> {
  const { buf, bytes, abs } = await readInput(input);
  return finish(open(buf).rotate(), format, o, outputPathFor(abs, "", format, o.output), bytes);
}

/** A small JPEG preview for chat clients that render image content. */
export async function preview(file: string, max = 320): Promise<{ data: string; mimeType: "image/jpeg" }> {
  const buf = await sharp(file, { limitInputPixels: MAX_PIXELS })
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 70 })
    .toBuffer();
  return { data: buf.toString("base64"), mimeType: "image/jpeg" };
}
