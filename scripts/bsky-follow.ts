import { getPdsEndpoint } from "npm:@atcute/identity@1.1.4";
import type { Did } from "npm:@atcute/lexicons@1.2.9";

function loadSecrets(path: string): Record<string, string> {
  const text = Deno.readTextFileSync(path);
  return Object.fromEntries(text.split("\n").filter(Boolean).map((l) => l.split("=", 2)));
}

const secrets = loadSecrets(new URL(".secrets", import.meta.url).pathname);
const pdsUrl = "https://sharkgirl.pet";

const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: secrets.BLUESKY_HANDLE, password: secrets.BLUESKY_PASSWORD }),
});
const data = await res.json();
let pdsUri: string | undefined;
try { pdsUri = await getPdsEndpoint(data.did); } catch {}

async function follow(did: string, handle: string) {
  const r = await fetch(`${pdsUri || pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.accessJwt}` },
    body: JSON.stringify({
      repo: data.did,
      collection: "app.bsky.graph.follow",
      record: { $type: "app.bsky.graph.follow", subject: did, createdAt: new Date().toISOString() },
    }),
  });
  if (!r.ok) { const e = await r.json(); console.error(`follow ${handle} failed:`, e); return; }
  const result = await r.json();
  console.log(`following ${handle}: ${result.uri}`);
}

await follow("did:plc:3rwz3xfw2crswgifqgc3g7zh", "null.namespaces.me");
