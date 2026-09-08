#!/usr/bin/env node
/**
 * roundcut-mcp: local image tools as MCP tools, by RoundCut (https://roundcut.app).
 * stdio transport. stdout is the protocol channel: log only through console.error.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { FORMATS, circleCrop, compress, convert, crop, info, preview, resize, type Report } from "./engine.js";

const VERSION = "0.1.0";
const SITE = "https://roundcut.app";

const format = z.enum(FORMATS);
const quality = z.number().int().min(1).max(100).optional().describe("Lossy quality 1-100 (default 80). Ignored for png.");
const background = z.string().optional().describe("CSS color used to flatten transparency when the output is jpeg (default #ffffff).");
const output = z.string().optional().describe("Output file path. Default: next to the input, with a suffix and the right extension.");
const withPreview = z.boolean().optional().describe("Attach a small JPEG preview to the result (default true).");

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/jpeg" }
  | { type: "resource_link"; uri: string; name: string; mimeType: string };

function sizeDelta(r: Report): string {
  if (!r.inputBytes) return "";
  const d = Math.round((1 - r.bytes / r.inputBytes) * 100);
  return d >= 0 ? `${d}% smaller than` : `${-d}% larger than`;
}

async function result(r: Report, wantPreview: boolean | undefined, line: string) {
  const text = [
    line,
    r.output,
    `${r.width}x${r.height} ${r.format}, ${r.bytes.toLocaleString()} bytes (${sizeDelta(r)} the ${r.inputBytes.toLocaleString()}-byte input)`,
  ].join("\n");
  const content: Content[] = [
    { type: "text", text },
    { type: "resource_link", uri: `file://${r.output}`, name: r.output.split("/").pop() ?? r.output, mimeType: `image/${r.format}` },
  ];
  if (wantPreview ?? true) content.push({ type: "image", ...(await preview(r.output)) });
  return { content, structuredContent: { ...r } };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "roundcut-mcp", version: VERSION });

  server.registerTool(
    "image_info",
    {
      title: "Image info",
      description: "Read format, dimensions, alpha and EXIF orientation of an image file.",
      inputSchema: z.object({ input: z.string().describe("Path to a JPG, PNG, WebP, AVIF, GIF, TIFF or HEIC file.") }),
      annotations: { readOnlyHint: true },
    },
    async ({ input }) => {
      try {
        const i = await info(input);
        return { content: [{ type: "text", text: JSON.stringify(i, null, 2) }], structuredContent: i };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "circle_crop",
    {
      title: "Circle crop",
      description:
        "Make a round profile picture: center-square crop plus a circular transparent mask. png (default), webp and avif keep the transparent corners; jpeg flattens them onto a background color.",
      inputSchema: z.object({
        input: z.string(),
        output,
        size: z.number().int().min(16).max(8192).optional().describe("Output side in pixels (default: the largest centered square)."),
        format: format.optional(),
        quality,
        background,
        preview: withPreview,
      }),
    },
    async ({ input, preview: p, ...o }) => {
      try {
        return await result(await circleCrop(input, o), p, "Circle crop done.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "crop_image",
    {
      title: "Crop image",
      description: "Crop to a pixel box (left, top, width, height) or to a centered aspect ratio such as 1:1, 4:5 or 16:9.",
      inputSchema: z.object({
        input: z.string(),
        output,
        left: z.number().int().min(0).optional(),
        top: z.number().int().min(0).optional(),
        width: z.number().int().min(1).optional(),
        height: z.number().int().min(1).optional(),
        aspect: z.string().regex(/^\d+:\d+$/).optional().describe("Centered crop to this ratio, e.g. 16:9. Overrides the pixel box."),
        format: format.optional(),
        quality,
        background,
        preview: withPreview,
      }),
    },
    async ({ input, preview: p, ...o }) => {
      try {
        return await result(await crop(input, o), p, "Crop done.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "resize_image",
    {
      title: "Resize image",
      description: "Resize by width, height or percent. Keeps the aspect ratio (fit=inside) and never enlarges unless enlarge=true. Lanczos3 resampling.",
      inputSchema: z.object({
        input: z.string(),
        output,
        width: z.number().int().min(1).max(16384).optional(),
        height: z.number().int().min(1).max(16384).optional(),
        percent: z.number().min(1).max(400).optional(),
        fit: z.enum(["inside", "cover", "fill"]).optional(),
        enlarge: z.boolean().optional(),
        format: format.optional(),
        quality,
        background,
        preview: withPreview,
      }),
    },
    async ({ input, preview: p, ...o }) => {
      try {
        return await result(await resize(input, o), p, "Resize done.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "compress_image",
    {
      title: "Compress image",
      description: "Smaller file, same format. jpg/webp/avif re-encode at `quality` (default 80, mozjpeg for jpg); png is recompressed losslessly.",
      inputSchema: z.object({ input: z.string(), output, quality, preview: withPreview }),
    },
    async ({ input, preview: p, ...o }) => {
      try {
        return await result(await compress(input, o), p, "Compress done.");
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "convert_image",
    {
      title: "Convert image",
      description: "Convert between jpeg, png, webp and avif (the input may also be GIF, TIFF or HEIC). Transparency is kept except for jpeg, which is flattened onto `background`.",
      inputSchema: z.object({ input: z.string(), format, output, quality, background, preview: withPreview }),
    },
    async ({ input, format: f, preview: p, ...o }) => {
      try {
        return await result(await convert(input, f, o), p, `Converted to ${f}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "roundcut_web_tools",
    {
      title: "RoundCut web tools",
      description:
        "Links to the RoundCut browser tools for what this server does not do locally: AI background removal, AI upscaling, batch conversion and image-to-PDF. Free, 29 languages.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: [
            `Background remover: ${SITE}/background-remover/`,
            `AI upscaler: ${SITE}/upscale-2x/`,
            `Batch convert: ${SITE}/convert/`,
            `JPG to PDF: ${SITE}/jpg-to-pdf/`,
            `All tools: ${SITE}/`,
          ].join("\n"),
        },
      ],
    }),
  );

  return server;
}

const entry = process.argv[1] ? process.argv[1].split("/").pop() ?? "" : "";
if (entry && import.meta.url.endsWith(entry)) {
  const handle = serveStdio(buildServer);
  process.on("SIGINT", () => {
    void handle.close();
  });
}
