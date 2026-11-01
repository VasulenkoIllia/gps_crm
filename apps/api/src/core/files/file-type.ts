// What a file is, by its first bytes: the name and the type the browser sends are only claims (06-quality.md §6.2.2)
export interface DetectedFileType {
  mime: string;
}

const PDF_MAGIC = Buffer.from("%PDF-");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_MAGIC = Buffer.from("RIFF");
const WEBP_MAGIC = Buffer.from("WEBP");
const WEBP_MAGIC_OFFSET = 8;

function startsWith(content: Buffer, magic: Buffer, offset = 0): boolean {
  return content.subarray(offset, offset + magic.length).equals(magic);
}

export function detectFileType(content: Buffer): DetectedFileType | null {
  if (startsWith(content, PDF_MAGIC)) return { mime: "application/pdf" };
  if (startsWith(content, PNG_MAGIC)) return { mime: "image/png" };
  if (startsWith(content, JPEG_MAGIC)) return { mime: "image/jpeg" };
  if (startsWith(content, RIFF_MAGIC) && startsWith(content, WEBP_MAGIC, WEBP_MAGIC_OFFSET)) {
    return { mime: "image/webp" };
  }
  return null;
}
