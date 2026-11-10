import { isIP } from "node:net";

export const clientIpHeader = "x-washroom-client-ip";

export function canonicalIp(value: string): string {
  const ip = value.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) throw new Error("A valid client IP address is required.");
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

async function keyFor(secret: string) {
  if (secret.length < 32) throw new Error("GATEWAY_IP_SIGNING_SECRET must contain at least 32 characters.");
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function signClientIp(ip: string, secret: string, now = Date.now()): Promise<string> {
  const key = await keyFor(secret);
  const digest = hex(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`washroom-ip:${canonicalIp(ip)}`),
  ));
  const payload = `${digest}.${Math.floor(now / 1000)}`;
  const signature = hex(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`washroom-ip-assertion:${payload}`),
  ));
  return `${payload}.${signature}`;
}

export async function verifyClientIp(token: string | null, secret: string, now = Date.now()): Promise<string | null> {
  const key = await keyFor(secret);
  const match = token && /^([a-f0-9]{64})\.(\d{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [, digest, issued, signature] = match;
  const age = Math.floor(now / 1000) - Number(issued);
  if (age < -5 || age > 30) return null;
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  const valid = await crypto.subtle.verify("HMAC", key, bytes,
    new TextEncoder().encode(`washroom-ip-assertion:${digest}.${issued}`));
  return valid ? digest : null;
}
