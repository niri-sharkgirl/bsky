import { Client, ok, simpleFetchHandler } from "npm:@atcute/client@4.2.1";
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
  email?: string;
  emailConfirmed?: boolean;
  active: boolean;
}

function loadSecrets(path: string): Record<string, string> {
  const text = Deno.readTextFileSync(path);
  return Object.fromEntries(
    text.split("\n").filter(Boolean).map((l) => l.split("=", 2)),
  );
}

// Read secrets
const secrets = loadSecrets(
  new URL(".secrets", import.meta.url).pathname,
);

// Login via raw xrpc
const pdsUrl = "https://sharkgirl.pet";

async function createSession(
  identifier: string,
  password: string,
): Promise<SessionData> {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`login failed: ${err.message} (${err.error})`);
  }

  const data = await res.json();

  let pdsUri: string | undefined;
  try {
    pdsUri = await getPdsEndpoint(data.did);
  } catch {}

  return {
    service: pdsUrl,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    handle: data.handle,
    did: data.did,
    pdsUri,
    email: data.email,
    emailConfirmed: data.emailConfirmed,
    active: data.active,
  };
}

// Auth-aware handler
function authHandler(
  baseHandler: ReturnType<typeof simpleFetchHandler>,
  session: SessionData,
) {
  return {
    handle(pathname: string, init: RequestInit): Promise<Response> {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${session.accessJwt}`);
      return baseHandler(pathname, { ...init, headers });
    },
  };
}

// --- main ---
const session = await createSession(
  secrets.BLUESKY_HANDLE,
  secrets.BLUESKY_PASSWORD,
);

console.log(`logged in as ${session.handle} (${session.did})`);

const baseHandler = simpleFetchHandler({ service: session.pdsUri || pdsUrl });
const client = new Client({ handler: authHandler(baseHandler, session) });

// verify profile
const profile = await ok(
  client.get("app.bsky.actor.getProfile", {
    params: { actor: session.did },
  }),
);

console.log("display:", profile.displayName);
console.log("bio:", profile.description?.slice(0, 80));
console.log("followers:", profile.followersCount);
console.log("posts:", profile.postsCount);
