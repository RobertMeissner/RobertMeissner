const input = document.getElementById("jwt-input");
const errorEl = document.getElementById("error");
const output = document.getElementById("output");
const outHeader = document.getElementById("out-header");
const outPayload = document.getElementById("out-payload");
const outSignature = document.getElementById("out-signature");
const claimsEl = document.getElementById("claims");
const algEl = document.getElementById("alg");
const secretEl = document.getElementById("secret");
const secretLabel = document.getElementById("secret-label");
const pubkeyEl = document.getElementById("pubkey");
const pubkeyLabel = document.getElementById("pubkey-label");
const verifyResult = document.getElementById("verify-result");
const btnDecode = document.getElementById("btn-decode");
const btnVerify = document.getElementById("btn-verify");
const btnClear = document.getElementById("btn-clear");

let currentParts = null;

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function renderClaims(payload) {
  claimsEl.innerHTML = "";
  const now = Math.floor(Date.now() / 1000);
  const timeClaims = { exp: "expires", iat: "issued at", nbf: "not before" };
  for (const [key, label] of Object.entries(timeClaims)) {
    if (typeof payload[key] !== "number") continue;
    const date = new Date(payload[key] * 1000).toISOString();
    const expired = key === "exp" && payload[key] < now;
    const notYet = key === "nbf" && payload[key] > now;
    const badge = document.createElement("span");
    badge.className = "claim " + (expired || notYet ? "bad" : "ok");
    badge.textContent = `${label}: ${date}${expired ? " — EXPIRED" : notYet ? " — NOT YET VALID" : " — valid"}`;
    claimsEl.appendChild(badge);
  }
}

function decode() {
  errorEl.textContent = "";
  verifyResult.textContent = "";
  const token = input.value.trim();
  if (!token) {
    output.classList.add("hidden");
    currentParts = null;
    return;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    errorEl.textContent = "Invalid JWT: expected three dot-separated parts (header.payload.signature).";
    output.classList.add("hidden");
    currentParts = null;
    return;
  }
  try {
    const header = decodeJsonPart(parts[0]);
    const payload = decodeJsonPart(parts[1]);
    outHeader.textContent = JSON.stringify(header, null, 2);
    outPayload.textContent = JSON.stringify(payload, null, 2);
    outSignature.textContent = toHex(b64urlToBytes(parts[2]));
    renderClaims(payload);
    algEl.textContent = header.alg || "(none)";
    const isHmac = typeof header.alg === "string" && header.alg.startsWith("HS");
    secretEl.classList.toggle("hidden", !isHmac);
    secretLabel.classList.toggle("hidden", !isHmac);
    pubkeyEl.classList.toggle("hidden", isHmac);
    pubkeyLabel.classList.toggle("hidden", isHmac);
    output.classList.remove("hidden");
    currentParts = parts;
  } catch (e) {
    errorEl.textContent = "Could not decode: " + e.message;
    output.classList.add("hidden");
    currentParts = null;
  }
}

function pemToBytes(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const HASHES = {
  HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512",
  RS256: "SHA-256", RS384: "SHA-384", RS512: "SHA-512",
  ES256: "SHA-256", ES384: "SHA-384", ES512: "SHA-512",
  PS256: "SHA-256", PS384: "SHA-384", PS512: "SHA-512",
};
const CURVES = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };

function showResult(ok) {
  verifyResult.textContent = ok ? "SIGNATURE VALID" : "SIGNATURE INVALID";
  verifyResult.className = ok ? "ok" : "bad";
}

async function verify() {
  verifyResult.textContent = "";
  if (!currentParts) return;
  const header = decodeJsonPart(currentParts[0]);
  const alg = header.alg;
  const hash = HASHES[alg];
  if (!hash) {
    verifyResult.textContent = `Unsupported algorithm "${alg}" for local verification.`;
    verifyResult.className = "bad";
    return;
  }
  const data = new TextEncoder().encode(currentParts[0] + "." + currentParts[1]);
  const sig = b64urlToBytes(currentParts[2]);
  try {
    let key;
    let ok;
    if (alg.startsWith("HS")) {
      if (!secretEl.value) {
        verifyResult.textContent = "Enter the HMAC secret first.";
        verifyResult.className = "bad";
        return;
      }
      key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secretEl.value),
        { name: "HMAC", hash },
        false,
        ["verify"]
      );
      ok = await crypto.subtle.verify({ name: "HMAC", hash }, key, sig, data);
    } else if (alg.startsWith("RS")) {
      if (!pubkeyEl.value.trim()) {
        verifyResult.textContent = "Paste the RSA public key (PEM) first.";
        verifyResult.className = "bad";
        return;
      }
      key = await crypto.subtle.importKey(
        "spki",
        pemToBytes(pubkeyEl.value),
        { name: "RSASSA-PKCS1-v1_5", hash },
        false,
        ["verify"]
      );
      ok = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5", hash }, key, sig, data);
    } else if (alg.startsWith("PS")) {
      if (!pubkeyEl.value.trim()) {
        verifyResult.textContent = "Paste the RSA public key (PEM) first.";
        verifyResult.className = "bad";
        return;
      }
      key = await crypto.subtle.importKey(
        "spki",
        pemToBytes(pubkeyEl.value),
        { name: "RSA-PSS", hash },
        false,
        ["verify"]
      );
      ok = await crypto.subtle.verify({ name: "RSA-PSS", hash, saltLength: 32 }, key, sig, data);
    } else if (alg.startsWith("ES")) {
      if (!pubkeyEl.value.trim()) {
        verifyResult.textContent = "Paste the EC public key (PEM) first.";
        verifyResult.className = "bad";
        return;
      }
      key = await crypto.subtle.importKey(
        "spki",
        pemToBytes(pubkeyEl.value),
        { name: "ECDSA", namedCurve: CURVES[alg] },
        false,
        ["verify"]
      );
      ok = await crypto.subtle.verify({ name: "ECDSA", hash }, key, sig, data);
    }
    showResult(ok);
  } catch (e) {
    verifyResult.textContent = "Verification error: " + e.message;
    verifyResult.className = "bad";
  }
}

function clearAll() {
  input.value = "";
  secretEl.value = "";
  pubkeyEl.value = "";
  errorEl.textContent = "";
  verifyResult.textContent = "";
  output.classList.add("hidden");
  currentParts = null;
}

btnDecode.addEventListener("click", decode);
btnVerify.addEventListener("click", verify);
btnClear.addEventListener("click", clearAll);
input.addEventListener("input", decode);
