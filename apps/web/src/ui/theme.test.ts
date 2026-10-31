import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTheme, THEME_COLORS } from "./theme";

const MIN_TEXT_CONTRAST = 4.5;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("buildTheme", () => {
  it("keeps the demo tokens on every screen", () => {
    for (const theme of [buildTheme(false), buildTheme(true)]) {
      expect(theme.token).toMatchObject({ colorPrimary: THEME_COLORS.primary, borderRadius: 8 });
    }
  });

  it.each(["primary", "good", "critical"] as const)("%s reads as text on the page and on a panel", (name) => {
    expect(contrast(THEME_COLORS[name], THEME_COLORS.page)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(THEME_COLORS[name], THEME_COLORS.surface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("matches the colors in styles.css", () => {
    const styles = readFileSync(resolve(import.meta.dirname, "styles.css"), "utf8");
    expect(styles).toContain(`--accent: ${THEME_COLORS.primary}`);
    expect(styles).toContain(`--page: ${THEME_COLORS.page}`);
  });

  it("gives phones 16px text and 44px controls", () => {
    expect(buildTheme(true).token).toMatchObject({ fontSize: 16, controlHeight: 44 });
    expect(buildTheme(false).token).not.toHaveProperty("fontSize");
  });
});
