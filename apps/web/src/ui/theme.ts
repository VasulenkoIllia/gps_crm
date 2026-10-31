import type { ThemeConfig } from "antd";

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BORDER_RADIUS_PX = 8;
// iOS zooms into fields below 16px, and tap targets start at 44px
const PHONE_FONT_SIZE_PX = 16;
const PHONE_CONTROL_HEIGHT_PX = 44;

// 05-ui-standard.md §5.9: each accent keeps 4.5:1 as text, also on the page background
export const THEME_COLORS = {
  primary: "#2771c9",
  page: "#f6f6f4",
  surface: "#ffffff",
  ink: "#0b0b0b",
  good: "#0a820a",
  critical: "#ce3a3a",
} as const;

const BASE_TOKENS = {
  colorPrimary: THEME_COLORS.primary,
  colorBgLayout: THEME_COLORS.page,
  colorSuccess: THEME_COLORS.good,
  colorError: THEME_COLORS.critical,
  borderRadius: BORDER_RADIUS_PX,
  fontFamily: FONT_FAMILY,
};

export function buildTheme(isPhone: boolean): ThemeConfig {
  if (!isPhone) return { token: BASE_TOKENS };
  return {
    token: { ...BASE_TOKENS, fontSize: PHONE_FONT_SIZE_PX, controlHeight: PHONE_CONTROL_HEIGHT_PX },
    components: { Menu: { itemHeight: PHONE_CONTROL_HEIGHT_PX } },
  };
}
