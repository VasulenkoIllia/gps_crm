const NOT_PLAIN_ASCII = /[^\x20-\x7e]|["\\]/g;

// RFC 6266: the plain name for what cannot read more, and the name as it is, percent-encoded, for everyone else.
// encodeURIComponent leaves these five alone, and RFC 5987 does not allow them.
function encodeExtended(name: string): string {
  return encodeURIComponent(name).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function contentDisposition(disposition: "inline" | "attachment", name: string): string {
  return `${disposition}; filename="${name.replace(NOT_PLAIN_ASCII, "_")}"; filename*=UTF-8''${encodeExtended(name)}`;
}
