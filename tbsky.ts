#!/usr/bin/env deno run -A
// tbsky thread parser

function cleanHTML(raw) {
  return raw
    .replace(/<br\s*\/??>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/'/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/"/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const url = Deno.args[0];
if (!url) {
  console.error("usage: deno run -A tbsky.ts <tbsky_url>");
  Deno.exit(1);
}

let normalized = url.trim();
if (!normalized.startsWith("http")) normalized = "https://" + normalized;

console.error("fetching: " + normalized);

const resp = await fetch(normalized);
if (!resp.ok) {
  console.error("HTTP " + resp.status + ": " + resp.statusText);
  Deno.exit(1);
}

const html = await resp.text();

const articleRegex = new RegExp("<article class=\"thread-post\"[^>]*data-handle=\"([^\"]*)\"[^>]*data-uri=\"([^\"]*)\"[^>]*>(.*?)<\\/article>", "gs");
const posts = [];

let match;
while ((match = articleRegex.exec(html)) !== null) {
  const handle = match[1];
  const uri = match[2];
  const body = match[3];

  const pRegex = new RegExp("<p[^>]*>(.*?)<\\/p>", "gs");
  let parts = [];
  let pMatch;
  while ((pMatch = pRegex.exec(body)) !== null) {
    const c = cleanHTML(pMatch[1]);
    if (c.length > 0) parts.push(c);
  }

  if (parts.length > 0) {
    posts.push({ handle: handle, uri: uri, text: parts.join("\n") });
  }
}

if (posts.length === 0) {
  console.error("no posts found. is this a valid tbsky thread URL?");
  Deno.exit(1);
}

const authorRegex = new RegExp("class=\"author-handle\"[^>]*>\\s*@?(\\S+?)\\s*<\\/");
const authorMatch = html.match(authorRegex);
const author = authorMatch ? authorMatch[1] : "";
const titleRegex = new RegExp("class=\"title-link\"[^>]*>(.*?)<\\/a>", "s");
const titleMatch = html.match(titleRegex);
const title = titleMatch ? cleanHTML(titleMatch[1]) : "Thread";

console.log("=== " + title + " ===");
if (author) console.log("by @" + author);
console.log(posts.length + " post" + (posts.length > 1 ? "s" : "") + "\n");

for (let i = 0; i < posts.length; i++) {
  const p = posts[i];
  console.log("--- [" + (i+1) + "/" + posts.length + "] @" + p.handle + " ---");
  console.log(p.text);
  console.log("uri: " + p.uri);
  console.log("");
}
