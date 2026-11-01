import type { FastifyRequest } from "fastify";

// Cloudflare's published ranges (cloudflare.com/ips-v4, /ips-v6). Hard-coded: a network call at start would let somebody
// else's website stop this app, and they change once in years. client-ip.test.ts pins them.
const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const IPV4_BITS = 32;
const IPV6_BITS = 128;
const IPV6_GROUPS = 8;
const IPV6_HOST_BITS = 64n;
const BYTE_MAX = 255;
const ADDRESS_ONLY = /^[0-9a-f:.]+$/i;
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

interface AddressBits {
  value: bigint;
  width: number;
}

function ipv4Bits(address: string): AddressBits | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > BYTE_MAX) return null;
    value = (value << 8n) | BigInt(part);
  }
  return { value, width: IPV4_BITS };
}

function ipv6Bits(address: string): AddressBits | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const fill = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? head.length !== IPV6_GROUPS : fill < 0) return null;
  const groups = halves.length === 1 ? head : [...head, ...new Array<string>(fill).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return { value, width: IPV6_BITS };
}

function toBits(address: string): AddressBits | null {
  const plain = IPV4_MAPPED.exec(address)?.[1] ?? address;
  return plain.includes(":") ? ipv6Bits(plain) : ipv4Bits(plain);
}

const RANGES = CLOUDFLARE_RANGES.map((cidr) => {
  const [network = "", prefix = ""] = cidr.split("/");
  const bits = toBits(network);
  if (!bits) throw new Error(`client-ip: unreadable range ${cidr}`);
  const host = BigInt(bits.width - Number(prefix));
  return { width: bits.width, host, network: bits.value >> host };
});

export function isCloudflare(address: string): boolean {
  const bits = toBits(address);
  if (!bits) return false;
  return RANGES.some((range) => range.width === bits.width && bits.value >> range.host === range.network);
}

function isAddress(value: string): boolean {
  return ADDRESS_ONLY.test(value) && toBits(value) !== null;
}

// A rented server gets a whole /64 and can use a new address for every request, so for counting tries the network is
// the caller
export function throttleAddress(address: string): string {
  const plain = IPV4_MAPPED.exec(address)?.[1] ?? address;
  const bits = plain.includes(":") ? ipv6Bits(plain) : null;
  return bits ? `${(bits.value >> IPV6_HOST_BITS).toString(16)}::/64` : plain;
}

// The chain is Cloudflare, Traefik, this app (14-stage1-plan.md, step 1). Traefik does not trust Cloudflare's
// X-Forwarded-For and replaces it with the peer it saw, so request.ip is the Cloudflare edge, or the real caller of a
// request that reached the server directly. Cloudflare overwrites CF-Connecting-IP, so the header counts only when the
// peer is one of its edges: anyone else who sends it is answered by their own address.
export function clientIp(request: Pick<FastifyRequest, "ip" | "headers">): string {
  const peer = request.ip;
  if (!isCloudflare(peer)) return peer;
  const claimed = request.headers["cf-connecting-ip"];
  const value = (Array.isArray(claimed) ? claimed[0] : claimed)?.trim();
  return value && isAddress(value) ? value : peer;
}
