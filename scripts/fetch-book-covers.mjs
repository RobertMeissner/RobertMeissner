#!/usr/bin/env node
// Resolves a cover image for every book in docs/books/books.json and downloads
// it into docs/books/covers/. Writes docs/books/manifest.json (books + cover
// path, cover: null when no cover could be found) which docs/books.html reads.
//
// Resolution order per book:
//   1. explicit "cover_url" field in books.json
//   2. "isbn" via Open Library covers API
//   3. title/author search on Open Library -> covers API
//   4. title/author search on Google Books API -> imageLinks
//   5. "goodreads" URL -> og:image meta tag
//
// Usage: node scripts/fetch-book-covers.mjs [--force]
// Env overrides (used by tests): OL_COVERS_BASE, OL_SEARCH_URL, GBOOKS_URL,
// BOOKS_PATH, COVERS_DIR, MANIFEST_PATH.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOOKS_PATH = process.env.BOOKS_PATH ?? join(repoRoot, "docs/books/books.json");
const COVERS_DIR = process.env.COVERS_DIR ?? join(repoRoot, "docs/books/covers");
const MANIFEST_PATH = process.env.MANIFEST_PATH ?? join(repoRoot, "docs/books/manifest.json");

const OL_COVERS_BASE = process.env.OL_COVERS_BASE ?? "https://covers.openlibrary.org/b";
const OL_SEARCH_URL = process.env.OL_SEARCH_URL ?? "https://openlibrary.org/search.json";
const GBOOKS_URL = process.env.GBOOKS_URL ?? "https://www.googleapis.com/books/v1/volumes";

const FORCE = process.argv.includes("--force");
const UA = "RobertMeissner-bookshelf/1.0 (+https://robertmeissner.github.io/RobertMeissner/books.html)";
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function bookSlug(book) {
  return slugify(`${book.title ?? "untitled"} ${book.author ?? ""}`);
}

async function fetchOk(url, { headers = {}, timeoutMs = 15000 } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

async function fetchJson(url, opts) {
  const res = await fetchOk(url, opts);
  if (!res) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function imageKind(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer.length > 6 && buffer.toString("ascii", 0, 3) === "GIF") return "gif";
  if (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) return "webp";
  return null;
}

async function openLibraryCandidates(book) {
  const urls = [];
  if (book.isbn) {
    urls.push(`${OL_COVERS_BASE}/isbn/${encodeURIComponent(book.isbn)}-L.jpg?default=false`);
  }
  const params = new URLSearchParams({ limit: "5", fields: "cover_i,title,author_name" });
  if (book.title) params.set("title", book.title);
  if (book.author) params.set("author", book.author);
  const data = await fetchJson(`${OL_SEARCH_URL}?${params}`);
  for (const doc of data?.docs ?? []) {
    if (doc.cover_i) {
      urls.push(`${OL_COVERS_BASE}/id/${doc.cover_i}-L.jpg?default=false`);
    }
  }
  return urls;
}

async function googleBooksCandidates(book) {
  if (!book.title) return [];
  const q = new URLSearchParams({ maxResults: "5" });
  q.set("q", `intitle:${book.title}${book.author ? ` inauthor:${book.author}` : ""}`);
  const data = await fetchJson(`${GBOOKS_URL}?${q}`);
  const urls = [];
  for (const item of data?.items ?? []) {
    const links = item?.volumeInfo?.imageLinks;
    if (!links) continue;
    for (const key of ["extraLarge", "large", "medium", "small", "thumbnail"]) {
      if (links[key]) {
        urls.push(links[key].replace(/^http:\/\//, "https://"));
        break;
      }
    }
  }
  return urls;
}

async function goodreadsCandidates(book) {
  if (!book.goodreads) return [];
  const res = await fetchOk(book.goodreads, {
    headers: { "user-agent": BROWSER_UA, accept: "text/html" },
    timeoutMs: 10000,
  });
  if (!res) return [];
  const html = await res.text().catch(() => "");
  const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!match) return [];
  return [match[1].replace(/^http:\/\//, "https://")];
}

async function candidateUrls(book) {
  const urls = [];
  if (book.cover_url) urls.push(book.cover_url.replace(/^http:\/\//, "https://"));
  urls.push(...(await openLibraryCandidates(book)));
  urls.push(...(await googleBooksCandidates(book)));
  urls.push(...(await goodreadsCandidates(book)));
  return [...new Set(urls)];
}

async function downloadCover(urls, destWithoutExt) {
  for (const url of urls) {
    const res = await fetchOk(url, {
      headers: { "user-agent": BROWSER_UA, accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      timeoutMs: 20000,
    });
    if (!res) continue;
    const buffer = Buffer.from(await res.arrayBuffer());
    const kind = imageKind(buffer);
    if (!kind || buffer.length < 500) continue;
    const dest = `${destWithoutExt}.${kind}`;
    writeFileSync(dest, buffer);
    return { dest, kind, bytes: buffer.length };
  }
  return null;
}

const books = JSON.parse(readFileSync(BOOKS_PATH, "utf8"));
if (!Array.isArray(books)) {
  console.error(`::error::${BOOKS_PATH} must contain a JSON array of books`);
  process.exit(1);
}

mkdirSync(COVERS_DIR, { recursive: true });

const manifest = [];
let downloaded = 0;
let reused = 0;
let failed = 0;

for (const book of books) {
  const slug = bookSlug(book);
  const destWithoutExt = join(COVERS_DIR, slug);
  const existing = ["jpg", "png", "gif", "webp"]
    .map((ext) => `${destWithoutExt}.${ext}`)
    .find((file) => existsSync(file));

  let cover = null;
  if (existing && !FORCE) {
    cover = `books/covers/${slug}.${existing.split(".").pop()}`;
    reused++;
  } else {
    const result = await downloadCover(await candidateUrls(book), destWithoutExt);
    if (result) {
      cover = `books/covers/${slug}.${result.kind}`;
      downloaded++;
      console.log(`ok    ${book.title} <- ${result.bytes} bytes (${result.kind})`);
    } else {
      failed++;
      console.log(`::warning::no cover found for "${book.title}" by ${book.author ?? "?"}`);
    }
  }
  manifest.push({ ...book, slug, cover });
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`done: ${downloaded} downloaded, ${reused} reused, ${failed} without cover -> ${MANIFEST_PATH}`);
