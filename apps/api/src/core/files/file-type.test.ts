import { describe, expect, it } from "vitest";
import { detectFileType } from "./file-type.js";

describe("the type of a file", () => {
  it.each([
    ["PDF", Buffer.from("%PDF-1.7 ..."), "application/pdf"],
    ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "image/png"],
    ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]), "image/jpeg"],
    ["WebP", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]), "image/webp"],
  ])("knows %s by its first bytes", (_name, content, mime) => {
    expect(detectFileType(content)).toEqual({ mime });
  });

  it.each([
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["a WAV, which is RIFF too", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])],
    ["nothing", Buffer.alloc(0)],
  ])("refuses %s", (_name, content) => {
    expect(detectFileType(content)).toBeNull();
  });
});
