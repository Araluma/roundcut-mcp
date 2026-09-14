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

### Smithery

[smithery.ai/servers/araluma/roundcut-mcp](https://smithery.ai/servers/araluma/roundcut-mcp)
installs a self-contained bundle for macOS (Apple Silicon) and Windows (x64). On Linux or an
Intel Mac, use `npx` above.

## Tools

| Tool | What it does | An agent calls it when |
|---|---|---|
| `image_info` | Format, dimensions, alpha, EXIF orientation. | the user asks what an image is, or before picking crop/resize numbers |
| `circle_crop` | Round profile picture: centered square plus a circular transparent mask. `size`, `format` (png default), `background` for jpeg. | the user wants a round avatar for Discord, Slack, LinkedIn, WhatsApp or GitHub |
| `crop_image` | Pixel box (`left`, `top`, `width`, `height`) or a centered `aspect` such as `1:1`, `4:5`, `16:9`. | the user wants part of an image or a fixed ratio (square post, 4:5 portrait, 16:9 banner) |
| `resize_image` | By `width`, `height` or `percent`. Keeps the aspect ratio, never enlarges unless `enlarge: true`. Lanczos3. | the user gives target pixel dimensions |
| `compress_image` | Smaller file, same format. `quality` for jpg/webp/avif (mozjpeg for jpg), lossless recompression for png. | the file must be lighter (upload limit, faster page) at the same size and format |
| `convert_image` | To `jpeg`, `png`, `webp` or `avif`. Input may also be GIF, TIFF or HEIC. Transparency kept, or flattened onto `background` for jpeg. | the user needs another file type, e.g. iPhone HEIC to JPG, PNG to WebP |
| `roundcut_web_tools` | Links to the browser tools this server does not run locally: background remover, AI upscaler, batch convert, JPG to PDF. | the user asks for one of those, instead of declining |

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

Smithery release: `scripts/build-mcpb.sh` builds `build/roundcut-mcp-<version>.mcpb` from
`mcpb/manifest.json` (25 MB cap, so only the macOS arm64 and Windows x64 sharp binaries go in),
then `scripts/publish-smithery.sh` uploads it with the tool schemas read from the built server.

## License

MIT. Copyright Araluma.
