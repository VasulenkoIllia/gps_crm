const LIKE_SPECIALS = /[\\%_]/g;

export function escapeLike(text: string): string {
  return text.replace(LIKE_SPECIALS, "\\$&");
}
