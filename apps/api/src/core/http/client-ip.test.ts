import { describe, expect, it } from "vitest";
import { clientIp, isCloudflare, throttleAddress } from "./client-ip.js";

const EDGE = "173.245.48.1";
const CALLER = "203.0.113.9";

describe("throttleAddress", () => {
  it("counts a whole IPv6 /64 as one caller", () => {
    expect(throttleAddress("2001:db8:1:2::1")).toBe(throttleAddress("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(throttleAddress("2001:db8:1:2::1")).not.toBe(throttleAddress("2001:db8:1:3::1"));
  });

  it("leaves an IPv4 address alone, also in its IPv6 spelling", () => {
    expect(throttleAddress(CALLER)).toBe(CALLER);
    expect(throttleAddress(`::ffff:${CALLER}`)).toBe(CALLER);
  });

  it("leaves a value that is not an address alone", () => {
    expect(throttleAddress("unknown")).toBe("unknown");
  });
});

describe("isCloudflare", () => {
  it.each(["173.245.48.0", "173.245.63.255", "104.16.0.1", "2606:4700::1", "::ffff:172.64.0.1"])(
    "knows %s",
    (address) => {
      expect(isCloudflare(address)).toBe(true);
    },
  );

  it.each(["173.245.64.0", "203.0.113.9", "10.0.0.1", "127.0.0.1", "2001:db8::1", "not an address", ""])(
    "does not take %j for an edge",
    (address) => {
      expect(isCloudflare(address)).toBe(false);
    },
  );
});

describe("clientIp", () => {
  it("takes the header when the peer is an edge", () => {
    expect(clientIp({ ip: EDGE, headers: { "cf-connecting-ip": CALLER } })).toBe(CALLER);
  });

  it("ignores the header from anyone else, so nobody picks their own address", () => {
    expect(clientIp({ ip: CALLER, headers: { "cf-connecting-ip": "198.51.100.1" } })).toBe(CALLER);
  });

  it("stays on the edge without the header", () => {
    expect(clientIp({ ip: EDGE, headers: {} })).toBe(EDGE);
  });

  it.each(["1.2.3.4%evil", "<script>", "1.2.3", "999.1.1.1", "1.2.3.4, 5.6.7.8"])(
    "refuses %s in the header",
    (value) => {
      expect(clientIp({ ip: EDGE, headers: { "cf-connecting-ip": value } })).toBe(EDGE);
    },
  );

  it("takes an IPv6 caller", () => {
    expect(clientIp({ ip: EDGE, headers: { "cf-connecting-ip": "2001:db8::42" } })).toBe("2001:db8::42");
  });
});
