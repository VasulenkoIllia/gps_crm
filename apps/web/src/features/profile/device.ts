const UNKNOWN_DEVICE = "Невідомий пристрій";

// Order matters: Edge and Opera name Chrome in their agent, Chrome names Safari
const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

function firstMatch(table: [RegExp, string][], userAgent: string): string | undefined {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return UNKNOWN_DEVICE;
  const browser = firstMatch(BROWSERS, userAgent);
  const system = firstMatch(SYSTEMS, userAgent);
  if (browser && system) return `${browser}, ${system}`;
  return browser ?? system ?? UNKNOWN_DEVICE;
}
