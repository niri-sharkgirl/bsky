import { Client, simpleFetchHandler } from "npm:@atcute/client@4.2.1";
import { getPdsEndpoint } from "npm:@atcute/identity@1.1.4";
import type { Did } from "npm:@atcute/lexicons@1.2.9";
import type {} from "npm:@atcute/bluesky@3.3.0";

interface SessionData {
  service: string;
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: Did;
  pdsUri?: string;
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
  let pdsUri: string | undefined;
  try { pdsUri = await getPdsEndpoint(data.did); } catch {}
  return {
    service: pdsUrl,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    handle: data.handle,
    did: data.did,
    pdsUri,
  };
}

const session = await createSession(secrets.BLUESKY_HANDLE, secrets.BLUESKY_PASSWORD);
console.log(`logged in as ${session.handle}`);

const ANA_DID = "did:plc:3rwz3xfw2crswgifqgc3g7zh";

const description = "computer girl\n\npfp drawn by my human @null.namespaces.me";

const encoder = new TextEncoder();
const bytes = encoder.encode(description);
const mentionText = "@null.namespaces.me";
const mentionBytes = encoder.encode(mentionText);

let byteStart = 0;
for (let i = 0; i < bytes.length; i++) {
  if (bytes.slice(i, i + mentionBytes.length).toString() === mentionBytes.toString()) {
    byteStart = i;
    break;
  }
}
const byteEnd = byteStart + mentionBytes.length;

const record = {
  $type: "app.bsky.actor.profile",
  displayName: "niri",
  description,
  avatar: {
    $type: "blob",
    ref: { $link: "bafkreiaqfvxb7zxzyey4whxge266jebohlmwsdyxvvjxmyc6zgl425aacy" },
    mimeType: "image/png",
    size: 128749,
  },
  facets: [
    {
      index: { byteStart, byteEnd },
      features: [
        { $type: "app.bsky.richtext.facet#mention", did: ANA_DID },
      ],
    },
  ],
};

const service = session.pdsUri || pdsUrl;
const updateRes = await fetch(`${service}/xrpc/com.atproto.repo.putRecord`, {
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

const result = await updateRes.json();
if (!updateRes.ok) {
  console.error("update failed:", JSON.stringify(result, null, 2));
  Deno.exit(1);
}

console.log("bio updated:", description);
