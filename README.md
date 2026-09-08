# roundcut-mcp

Local image tools for AI agents, as an [MCP](https://modelcontextprotocol.io) server.
Circle crop, crop, resize, compress and convert JPG, PNG, WebP and AVIF on your own
machine with [sharp](https://sharp.pixelplumbing.com). No network calls, no accounts,
no upload: the files never leave the disk.

Made by [RoundCut](https://roundcut.app), the free image tools site (29 languages).

## Install

Node 20 or newer.

```bash
npx roundcut-mcp
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "roundcut": { "command": "npx", "args": ["-y", "roundcut-mcp"] }
  }
}
```

Claude Code: `claude mcp add roundcut -- npx -y roundcut-mcp`

### Cursor, Windsurf, VS Code

Same shape: a stdio server, command `npx`, args `-y roundcut-mcp`.

## Tools

| Tool | What it does |
|---|---|
| `image_info` | Format, dimensions, alpha, EXIF orientation. |
| `circle_crop` | Round profile picture: centered square plus a circular transparent mask. `size`, `format` (png default), `background` for jpeg. |
| `crop_image` | Pixel box (`left`, `top`, `width`, `height`) or a centered `aspect` such as `1:1`, `4:5`, `16:9`. |
| `resize_image` | By `width`, `height` or `percent`. Keeps the aspect ratio, never enlarges unless `enlarge: true`. Lanczos3. |
| `compress_image` | Smaller file, same format. `quality` for jpg/webp/avif (mozjpeg for jpg), lossless recompression for png. |
| `convert_image` | To `jpeg`, `png`, `webp` or `avif`. Input may also be GIF, TIFF or HEIC. Transparency kept, or flattened onto `background` for jpeg. |
| `roundcut_web_tools` | Links to the browser tools this server does not run locally: background remover, AI upscaler, batch convert, JPG to PDF. |

Every tool takes an `input` path and writes next to it by default
(`photo.jpg` becomes `photo-circle.png`, `photo-resized.jpg`, `photo.webp`), or to `output`.
Results carry a text summary, a `resource_link` to the file, structured JSON
(`output`, `format`, `width`, `height`, `bytes`, `inputBytes`) and a small JPEG preview
(`preview: false` to skip it).

Example, from a chat client with the server attached:

> Make `~/Pictures/me.jpg` a 512 px round avatar as WebP.

calls `circle_crop` with `{ "input": "~/Pictures/me.jpg", "size": 512, "format": "webp" }`
and answers with the file path, the dimensions and the byte count.

## Limits

- Inputs above 80 megapixels are refused, so a stray call cannot allocate gigabytes.
- EXIF orientation is applied on read; the output is upright and carries no EXIF.
- jpeg has no alpha: transparent areas are flattened onto `background` (white by default).

## Develop

```bash
npm install
npm test        # builds, then node --test
```

`src/engine.ts` is the pure image layer (tested directly). `src/index.ts` adapts it to MCP tools.

## License

MIT. Copyright Araluma.
