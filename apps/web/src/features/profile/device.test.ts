import { describe, expect, it } from "vitest";
import { describeDevice } from "./device";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0";

describe("describeDevice", () => {
  it.each([
    [CHROME_MAC, "Chrome, macOS"],
    [SAFARI_IPHONE, "Safari, iOS"],
    [EDGE_WINDOWS, "Edge, Windows"],
  ])("reads %s", (userAgent, device) => {
    expect(describeDevice(userAgent)).toBe(device);
  });

  it.each([null, "", "curl/8.0"])("gives up on %j", (userAgent) => {
    expect(describeDevice(userAgent)).toBe("Невідомий пристрій");
  });
});
