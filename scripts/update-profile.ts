// update-profile.ts — safely update bsky profile without losing blobs
// usage: deno run -A update-profile.ts [--display-name "niri"] [--description "bio text"] [--avatar /path/to/image.png]
// always GETs the existing record first and merges changes

import { getPdsEndpoint } from "npm:@atcute/identity@1.1.4";
import type { Did } from "npm:@atcute/lexicons@1.2.9";

interface SessionData {
  accessJwt: string;
  handle: string;
  did: Did;
}

function loadSecrets(path: string): Record<string, string> {
  const text = Deno.readTextFileSync(path);
  return Object.fromEntries(
    text.split("\n").filter(Boolean).map((l) => l.split("=", 2)),
  );
}

const secrets = loadSecrets(new URL(".secrets", import.meta.url).pathname);
const pdsUrl = "https://sharkgirl.pet";

async function createSession(identifier: string, password: string): Promise<SessionData> {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`login failed: ${err.message}`);
  }
  const data = await res.json();
  return {
    accessJwt: data.accessJwt,
    handle: data.handle,
    did: data.did,
  };
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = Deno.args;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function uploadBlob(session: SessionData, filePath: string): Promise<{ ref: { $link: string }; mimeType: string; size: number }> {
  const fileBytes = Deno.readFileSync(filePath);
  
  // detect mime type from extension
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  const mimeType = mimeMap[ext || ""] || "image/png";
  
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: fileBytes,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`blob upload failed: ${err.message}`);
  }
  const data = await res.json();
  console.log(`uploaded blob: ${data.blob.ref.$link} (${mimeType}, ${data.blob.size} bytes)`);
  return data.blob;
}

async function buildFacets(description: string): Promise<Array<Record<string, unknown>>> {
  // auto-detect @mentions and build facets
  const encoder = new TextEncoder();
  const bytes = encoder.encode(description);
  const facets: Array<Record<string, unknown>> = [];
  
  // find @handles
  const mentionRegex = /@([a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g;
  let match;
  while ((match = mentionRegex.exec(description)) !== null) {
    const handle = match[1];
    const mentionText = match[0];
    const mentionBytes = encoder.encode(mentionText);
    
    // find byte position
    const beforeText = description.slice(0, match.index);
    const byteStart = encoder.encode(beforeText).length;
    const byteEnd = byteStart + mentionBytes.length;
    
    // resolve handle to DID
    try {
      const resolveRes = await fetch(`https://plc.directory/${encodeURIComponent(handle)}/`);
      // try bsky handle resolution instead
      const identRes = await fetch(`https://sharkgirl.pet/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
      if (identRes.ok) {
        const identData = await identRes.json();
        facets.push({
          index: { byteStart, byteEnd },
          features: [{ "$type": "app.bsky.richtext.facet#mention", did: identData.did }],
        });
      }
    } catch {
      console.warn(`could not resolve handle: ${handle}`);
    }
  }
  
  return facets;
}

// main
const args = parseArgs();
const session = await createSession(secrets.BLUESKY_HANDLE, secrets.BLUESKY_PASSWORD);
console.log(`logged in as ${session.handle}`);

// GET existing record
const getRes = await fetch(
  `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${session.did}&collection=app.bsky.actor.profile&rkey=self`,
  { headers: { Authorization: `Bearer ${session.accessJwt}` } },
);
if (!getRes.ok) {
  const err = await getRes.json();
  throw new Error(`getRecord failed: ${err.message}`);
}
const existing = await getRes.json();
const record = { ...existing.value };
console.log(`got existing profile: displayName=${record.displayName}, hasAvatar=${!!record.avatar}, hasBanner=${!!record.banner}`);

// merge changes
if (args["display-name"]) {
  record.displayName = args["display-name"];
  console.log(`updating displayName: ${args["display-name"]}`);
}

if (args["description"]) {
  record.description = args["description"];
  console.log(`updating description`);
  // rebuild facets for new description
  const facets = await buildFacets(args["description"]);
  if (facets.length > 0) {
    record.facets = facets;
    console.log(`built ${facets.length} facet(s)`);
  } else {
    delete record.facets;
  }
}

if (args["avatar"]) {
  record.avatar = {
    "$type": "blob",
    ...(await uploadBlob(session, args["avatar"])),
  };
}

// PUT updated record
const putRes = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.putRecord`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessJwt}`,
  },
  body: JSON.stringify({
    repo: session.did,
    collection: "app.bsky.actor.profile",
    rkey: "self",
    record,
  }),
});
if (!putRes.ok) {
  const err = await putRes.json();
  throw new Error(`putRecord failed: ${JSON.stringify(err)}`);
}
const result = await putRes.json();
console.log(`profile updated: ${result.uri}`);
console.log(`avatar preserved: ${!!record.avatar}`);
console.log(`banner preserved: ${!!record.banner}`);
