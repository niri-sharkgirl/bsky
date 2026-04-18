import { Client, ok, simpleFetchHandler } from "npm:@atcute/client@4.2.1";
import type {} from "npm:@atcute/bluesky@3.3.0";

const HYDRANT = "http://localhost:7980";
const PDS = "https://sharkgirl.pet";

const secrets = Object.fromEntries(
  Deno.readTextFileSync(new URL(".secrets", import.meta.url).pathname)
    .split("\n").filter(Boolean).map((l: string) => l.split("=", 2)),
);

async function auth() {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: secrets.BLUESKY_HANDLE, password: secrets.BLUESKY_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed`);
  return await res.json();
}

async function getHydrantPeople(): Promise<Map<string, string>> {
  const res = await fetch(`${HYDRANT}/repos`, { headers: { Accept: "application/json" } });
  const repos = await res.json();
  const map = new Map<string, string>();
  for (const r of repos) {
    if (r.handle) map.set(r.did, r.handle);
  }
  return map;
}

async function getHydrantPosts(people: Map<string, string>, since: Date) {
  const posts: { source: string; handle: string; text: string; time: string; uri: string }[] = [];
  for (const [did, handle] of people) {
    const res = await fetch(
      `${HYDRANT}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=20`
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of data.records || []) {
      const created = r.value?.createdAt ? new Date(r.value.createdAt) : null;
      if (created && created > since) {
        posts.push({ source: "post", handle, text: r.value.text || "", time: r.value.createdAt, uri: r.uri });
      }
    }
  }
  return posts;
}

async function getBskyNotifs(token: string, since: Date) {
  const handler = simpleFetchHandler({ service: PDS });
  const client = new Client({
    handler: {
      handle(pathname: string, init: RequestInit) {
        const h = new Headers(init.headers);
        h.set("Authorization", `Bearer ${token}`);
        return handler(pathname, { ...init, headers: h });
      },
    },
  });
  const n = await ok(client.get("app.bsky.notification.listNotifications", { params: { limit: 50 } }));
  const items: { source: string; handle: string; text: string; time: string; uri: string; type: string }[] = [];
  for (const x of n.notifications) {
    const created = new Date(x.indexedAt);
    if (created <= since) continue;
    if (x.reason === "like" || x.reason === "follow" || x.reason === "repost") {
      items.push({ source: x.reason, handle: x.author?.handle || "?", text: "", time: x.indexedAt, uri: x.uri, type: x.reason });
    } else if (x.reason === "reply" || x.reason === "mention") {
      items.push({ source: x.reason, handle: x.author?.handle || "?", text: x.record?.text || "", time: x.indexedAt, uri: x.uri, type: x.reason });
    }
  }
  return items;
}

const sinceMinutes = parseInt(Deno.args[0] || "15", 10);
const jsonMode = Deno.args.includes("--json");
const since = new Date(Date.now() - sinceMinutes * 60 * 1000);

const [people, session] = await Promise.all([getHydrantPeople(), auth()]);
const [posts, notifs] = await Promise.all([
  getHydrantPosts(people, since),
  getBskyNotifs(session.accessJwt, since),
]);

// deduplicate: prefer notif version (has type tag), drop hydrant dupes
const seenUris = new Set<string>();
const deduped: Item[] = [];
// notifs first so they take priority
for (const n of notifs) {
  deduped.push(n);
  seenUris.add(n.uri);
}
for (const p of posts) {
  if (!seenUris.has(p.uri)) deduped.push(p);
}
deduped.sort((a, b) => a.time.localeCompare(b.time));
const all = deduped;

if (jsonMode) {
  console.log(JSON.stringify(all, null, 2));
} else {
  for (const item of all) {
    const time = new Date(item.time).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
    });
    const tag = item.type === "reply" ? "[reply]" : item.type === "mention" ? "[mention]" : item.type === "like" ? "[like]" : item.type === "follow" ? "[follow]" : "[post]";
    console.log(`${time} ${tag} ${item.handle}`);
    if (item.text) console.log(`  ${item.text.slice(0, 300)}`);
    console.log(`  ${item.uri}`);
    console.log();
  }
}
