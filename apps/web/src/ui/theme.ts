import type { ThemeConfig } from "antd";

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BORDER_RADIUS_PX = 8;
// iOS zooms into fields below 16px, and tap targets start at 44px
const PHONE_FONT_SIZE_PX = 16;
const PHONE_CONTROL_HEIGHT_PX = 44;
// Seven of these fit 390px: a date panel grown with the phone font would stick out of the screen
const PHONE_DATE_CELL_WIDTH_PX = 44;

// 05-ui-standard.md §5.9: each accent keeps 4.5:1 as text, also on the page background
export const THEME_COLORS = {
  primary: "#2771c9",
  page: "#f6f6f4",
  surface: "#ffffff",
  ink: "#0b0b0b",
  good: "#0a820a",
  warning: "#8a5a00",
  critical: "#ce3a3a",
  placeholder: "#6b6a66",
  // Set by hand: from a seed this dark antd derives a grey background, and a tag loses its contrast on it
  goodSoft: "#eff8ef",
  goodLine: "#a9d3a9",
  warningSoft: "#fbf1dc",
  warningLine: "#e2c88f",
  criticalSoft: "#fff5f5",
  criticalLine: "#efb4b4",
  infoSoft: "#f2f7fd",
  infoLine: "#b5d0ee",
} as const;

const BASE_TOKENS = {
  colorPrimary: THEME_COLORS.primary,
  colorBgLayout: THEME_COLORS.page,
  colorInfo: THEME_COLORS.primary,
  colorLink: THEME_COLORS.primary,
  colorSuccess: THEME_COLORS.good,
  colorWarning: THEME_COLORS.warning,
  colorError: THEME_COLORS.critical,
  colorTextPlaceholder: THEME_COLORS.placeholder,
  colorSuccessBg: THEME_COLORS.goodSoft,
  colorSuccessBorder: THEME_COLORS.goodLine,
  colorWarningBg: THEME_COLORS.warningSoft,
  colorWarningBorder: THEME_COLORS.warningLine,
  colorErrorBg: THEME_COLORS.criticalSoft,
  colorErrorBorder: THEME_COLORS.criticalLine,
  colorInfoBg: THEME_COLORS.infoSoft,
  colorInfoBorder: THEME_COLORS.infoLine,
  borderRadius: BORDER_RADIUS_PX,
  fontFamily: FONT_FAMILY,
};

export function buildTheme(isPhone: boolean): ThemeConfig {
  if (!isPhone) return { token: BASE_TOKENS };
  return {
    token: { ...BASE_TOKENS, fontSize: PHONE_FONT_SIZE_PX, controlHeight: PHONE_CONTROL_HEIGHT_PX },
    components: {
      Menu: { itemHeight: PHONE_CONTROL_HEIGHT_PX },
      DatePicker: { cellWidth: PHONE_DATE_CELL_WIDTH_PX },
    },
  };
}
