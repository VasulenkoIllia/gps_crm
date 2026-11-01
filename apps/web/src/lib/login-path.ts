export const LOGIN_PATH = "/login";
const HOME_PATH = "/";
const APP_BASE = "https://app.invalid";

export function loginPath(next: string): string {
  return next === HOME_PATH ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

// `next` comes from the address bar: only a path inside this app, or a link could send a person to another site.
// Read the way the browser will read it, which drops tabs and line breaks and takes a backslash for a slash.
export function safeNextPath(next: string | null): string {
  if (!next?.startsWith("/") || !URL.canParse(next, APP_BASE)) return HOME_PATH;
  const url = new URL(next, APP_BASE);
  // After the origin, the path too: /.//evil.test is inside this app here and comes out of `pathname` as //evil.test
  if (url.origin !== APP_BASE || url.pathname.startsWith("//")) return HOME_PATH;
  return `${url.pathname}${url.search}${url.hash}`;
}
