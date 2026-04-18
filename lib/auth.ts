import { Client, simpleFetchHandler } from "npm:@atcute/client@4.2.1";
import { getSecrets, pdsUrl } from "./config.ts";

let sessionPromise: Promise<any> | undefined;

export async function auth() {
  const secrets = getSecrets(true);
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: secrets!.BLUESKY_HANDLE,
      password: secrets!.BLUESKY_PASSWORD,
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(`login failed: ${error.message}`);
  }
  return await res.json();
}

export async function getSession() {
  sessionPromise ??= auth();
  return await sessionPromise;
}

export function readClient(token: string) {
  const handler = simpleFetchHandler({ service: pdsUrl });
  return new Client({
    handler: {
      handle(pathname: string, init: RequestInit): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return handler(pathname, { ...init, headers });
      },
    },
  });
}

export async function getAuthedClient() {
  const session = await getSession();
  const token = session.accessJwt;
  return {
    session,
    token,
    did: session.did,
    client: readClient(token),
  };
}

export async function getOwnProfile(session: any) {
  const res = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${
      encodeURIComponent(session.did)
    }&collection=app.bsky.actor.profile&rkey=self`,
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
    },
  );
  if (!res.ok) throw new Error(`get profile failed: ${await res.text()}`);
  const data = await res.json();
  return data.value || {};
}

export async function putOwnProfile(
  session: any,
  record: Record<string, unknown>,
) {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.putRecord`, {
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
  if (!res.ok) throw new Error(`put profile failed: ${await res.text()}`);
  return await res.json();
}
