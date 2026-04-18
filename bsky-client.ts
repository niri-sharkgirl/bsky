import { Client, ok, simpleFetchHandler } from "npm:@atcute/client@4.2.1";
import type { ActorIdentifier, ResourceUri } from "npm:@atcute/lexicons@1.2.9";
import type {} from "npm:@atcute/bluesky@3.3.0";
import {
  getPdsEndpoint,
  webDidToDocumentUrl,
  isPlcDid,
  isWebDid,
} from "npm:@atcute/identity";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

// --- feed cache ---

const CACHE_PATH = new URL("./feed-cache.json", import.meta.url).pathname;

interface CachedPost {
  index: number;
  uri: string;
  cid: string;
  author: string;
  text: string;
  time: string;
  likes: number;
  replies: number;
  isRepost: boolean;
  repostedBy?: string;
}

function writeFeedCache(posts: CachedPost[]): void {
  Deno.writeTextFileSync(CACHE_PATH, JSON.stringify(posts, null, 2));
}

function readFeedCache(): CachedPost[] {
  try {
    return JSON.parse(Deno.readTextFileSync(CACHE_PATH));
  } catch {
    return [];
  }
}

function getFromCache(index: number): CachedPost | undefined {
  return readFeedCache().find((p) => p.index === index);
}

function cacheFeedItems(items: any[], startAt = 1): void {
  const posts: CachedPost[] = items
    .map((item: any, i: number) => {
      const p = item.post;
      const reason = item.reason;
      return {
        index: startAt + i,
        uri: p?.uri || item.uri || "",
        cid: p?.cid || item.cid || "",
        author: p?.author?.handle || item.author?.handle || "?",
        text: trunc((p?.record?.text || item.record?.text || "") + getEmbedAltText(p?.embed || item.embed)),
        time: p?.indexedAt || item.indexedAt || "",
        likes: p?.likeCount ?? item.likeCount ?? 0,
        replies: p?.replyCount ?? item.replyCount ?? 0,
        isRepost: !!reason,
        repostedBy: reason?.by?.handle,
      };
    })
    .filter((p) => p.uri);
  writeFeedCache(posts);
}

function cacheNotifItems(notifs: any[], startAt = 1): void {
  const posts: CachedPost[] = notifs
    .map((x: any, i: number) => ({
      index: startAt + i,
      uri: x.uri || "",
      cid: x.cid || "",
      author: x.author?.handle || "?",
      text: trunc((x.record?.text || "") + getEmbedAltText(x.embeds?.[0])),
      time: x.indexedAt || "",
      likes: 0,
      replies: 0,
      isRepost: false,
    }))
    .filter((p) => p.uri);
  writeFeedCache(posts);
}

// --- config ---

const secrets = Object.fromEntries(
  Deno.readTextFileSync(new URL(".secrets", import.meta.url).pathname)
    .split("\n").filter(Boolean).map((l) => l.split("=", 2)),
);
const pdsUrl = "https://sharkgirl.pet";

// --- auth ---

async function auth() {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: secrets.BLUESKY_HANDLE,
      password: secrets.BLUESKY_PASSWORD,
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`login failed: ${e.message}`);
  }
  return await res.json();
}

// --- atcute client (reads only) ---

function readClient(token: string) {
  const handler = simpleFetchHandler({ service: pdsUrl });
  return new Client({
    handler: {
      handle(pathname: string, init: RequestInit): Promise<Response> {
        const h = new Headers(init.headers);
        h.set("Authorization", `Bearer ${token}`);
        return handler(pathname, { ...init, headers: h });
      },
    },
  });
}

// --- raw fetch writes ---

async function write(
  collection: string,
  record: any,
  did: string,
  token: string,
) {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ repo: did, collection, record }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`write failed: ${JSON.stringify(e)}`);
  }
  const data = await res.json();
  const rkey = data.uri.split("/").pop();
  const check = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${collection}&rkey=${rkey}`,
  );
  if (!check.ok) throw new Error(`write verification failed: record not found`);
  const verified = await check.json();
  if (
    verified.value?.text !== undefined && verified.value.text !== record.text
  ) {
    throw new Error(`write verification failed: text mismatch`);
  }
  if (record.reply && verified.value?.reply) {
    if (verified.value.reply.parent.uri !== record.reply.parent.uri) {
      throw new Error(`write verification failed: reply parent mismatch`);
    }
    if (verified.value.reply.root.uri !== record.reply.root.uri) {
      throw new Error(`write verification failed: reply root mismatch`);
    }
  }
  if (record.subject && verified.value?.subject) {
    if (verified.value.subject.uri !== record.subject.uri) {
      throw new Error(`write verification failed: like subject mismatch`);
    }
  }
  return data;
}

// --- helpers ---

const trunc = (t: string | undefined, n = 2000) => t?.slice(0, n) || "";

async function getOwnProfile(session: any) {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(session.did)}&collection=app.bsky.actor.profile&rkey=self`, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
  if (!res.ok) throw new Error(`get profile failed: ${await res.text()}`);
  const data = await res.json();
  return data.value || {};
}

async function putOwnProfile(session: any, record: Record<string, unknown>) {
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.putRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
      record,
    }),
  });
  if (!res.ok) throw new Error(`put profile failed: ${await res.text()}`);
  return await res.json();
}

const DB_PATH = new URL("./interaction.db", import.meta.url).pathname;

type RelationshipClass = "oomf" | "safe" | "unsafe";

function openDb() {
  const db = new DB(DB_PATH);
  db.execute(`
    create table if not exists relationships (
      did text primary key,
      handle text,
      trust text not null,
      note text,
      source text not null default 'manual',
      updated_at text not null
    );

    create unique index if not exists idx_relationships_handle on relationships(handle);

    create table if not exists items (
      uri text primary key,
      cid text,
      source text not null,
      kind text not null,
      author_handle text,
      author_did text,
      text text,
      created_at text,
      indexed_at text,
      thread_root_uri text,
      parent_uri text,
      reply_to text,
      root_author text,
      upstream_safety text,
      has_unsafe_upstream integer not null default 0,
      needs_attention integer not null default 0,
      first_seen_at text not null,
      last_seen_at text not null,
      status text not null default 'unseen',
      action_taken text not null default 'none',
      decision_note text,
      last_decision_at text,
      reply_uri text,
      reply_cid text,
      like_uri text,
      like_cid text,
      raw_json text not null
    );
  `);
  return db;
}

const relationshipDb = openDb();

function getRelationshipClass(handle: string | undefined): RelationshipClass {
  if (!handle) return "unsafe";
  const row = [...relationshipDb.queryEntries<{ trust: string }>(
    `select trust from relationships where lower(handle) = lower(?) limit 1`,
    [handle],
  )][0];
  return row?.trust === "oomf" || row?.trust === "safe" ||
      row?.trust === "unsafe"
    ? row.trust
    : "unsafe";
}

function markInteraction(
  targetUri: string | undefined,
  status: "seen" | "acted",
  action: "liked" | "replied" | "followed",
  note: string,
  extra: Record<string, string> = {},
) {
  if (!targetUri) return;
  const now = new Date().toISOString();
  const before = relationshipDb.query(
    `select 1 from items where uri = ?`,
    [targetUri],
  );
  relationshipDb.query(
    `update items
     set status = ?,
         action_taken = ?,
         decision_note = ?,
         last_decision_at = ?,
         like_uri = coalesce(?, like_uri),
         reply_uri = coalesce(?, reply_uri)
     where uri = ?`,
    [
      status,
      action,
      note,
      now,
      extra.like_uri ?? null,
      extra.reply_uri ?? null,
      targetUri,
    ],
  );
  // if no row existed, insert a minimal record so likes/replies on
  // unscanned items still get tracked
  if (before.length === 0) {
    relationshipDb.query(
      `insert into items (uri, status, action_taken, decision_note, last_decision_at, first_seen_at, last_seen_at, like_uri, reply_uri, like_cid, reply_cid, source, kind, raw_json)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetUri,
        status,
        action,
        note,
        now,
        now,
        now,
        extra.like_uri ?? null,
        extra.reply_uri ?? null,
        extra.like_cid ?? null,
        extra.reply_cid ?? null,
        "manual",
        action === "liked" ? "like" : action === "replied" ? "reply" : "follow",
        "{}",
      ],
    );
  }
}

type ThreadContext = {
  parentAuthor?: string;
  rootAuthor?: string;
  upstreamAuthors: string[];
  upstreamRelationshipClasses: Record<string, RelationshipClass>;
  hasUnsafeUpstream: boolean;
};

function extractAltText(p: any): string {
  const embed = p.post?.embed;
  if (!embed) return "";
  const images = embed.images || [];
  const alts = images.map((img: any) => img.alt).filter(Boolean);
  if (alts.length > 0) return "\n[image: " + alts.join("; ") + "]";
  return "";
}

function formatPost(p: any, threadContext?: ThreadContext) {
  const reason = p.reason;
  const reply = p.post.record?.reply;
  const postText = p.post.record?.text || "";
  const altText = extractAltText(p);
  return {
    type: reason
      ? `${reason.$type?.split(".").pop() || "repost"} by ${reason.by?.handle}`
      : "post",
    author: p.post.author?.handle,
    text: trunc(postText + altText),
    time: p.post.indexedAt,
    likes: p.post.likeCount,
    replies: p.post.replyCount,
    uri: p.post.uri,
    cid: p.post.cid,
    ...(reply
      ? {
        replyTo: threadContext?.parentAuthor || reply.parent?.uri,
        rootAuthor: threadContext?.rootAuthor,
        upstreamAuthors: threadContext?.upstreamAuthors || [],
        upstreamRelationshipClasses:
          threadContext?.upstreamRelationshipClasses || {},
        hasUnsafeUpstream: threadContext?.hasUnsafeUpstream || false,
      }
      : {}),
  };
}

async function getPostThread(
  uri: string,
  token: string,
): Promise<any | undefined> {
  try {
    const res = await fetch(
      `${pdsUrl}/xrpc/app.bsky.feed.getPostThread?uri=${
        encodeURIComponent(uri)
      }&depth=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.thread;
  } catch {
    return undefined;
  }
}

function getThreadRootPost(thread: any): any {
  let current = thread;
  while (current?.parent?.post) current = current.parent;
  return current?.post;
}

async function resolveReplyRefs(
  parentUri: string,
  token: string,
): Promise<
  { parent: { uri: string; cid: string }; root: { uri: string; cid: string } }
> {
  // use getPosts instead of getPostThread — we only need the parent
  // record (for uri/cid and reply.root), not the whole thread tree.
  // getPostThread with depth=100 was causing hangs on slow PDS responses.
  const res = await fetch(
    `${pdsUrl}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(parentUri)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("could not resolve parent post");
  const data = await res.json();
  const parentPost = data.posts?.[0];
  if (!parentPost?.uri || !parentPost?.cid) {
    throw new Error("could not resolve parent post");
  }

  // use the parent post's reply.root directly.
  // every reply stores the root URI its author intended, so this is
  // correct 99% of the time. walking the parent chain can fail when
  // posts are deleted (the chain breaks) or when self-replies create
  // branch points. taking the parent's root is simpler and more reliable.
  const parentReplyRoot = parentPost?.record?.reply?.root;
  const root = parentReplyRoot?.uri && parentReplyRoot?.cid
    ? { uri: parentReplyRoot.uri, cid: parentReplyRoot.cid }
    : { uri: parentPost.uri, cid: parentPost.cid };

  return {
    parent: { uri: parentPost.uri, cid: parentPost.cid },
    root,
  };
}

function getReplyRecord(item: any): any {
  return item?.post?.record?.reply || item?.record?.reply;
}

async function hydrateReplyContext(
  items: any[],
  token: string,
): Promise<Map<string, ThreadContext>> {
  const parentUris: string[] = [];
  for (const item of items) {
    const reply = getReplyRecord(item);
    if (reply?.parent?.uri) parentUris.push(reply.parent.uri);
  }
  if (parentUris.length === 0) return new Map();

  const map = new Map<string, ThreadContext>();
  const unique = [...new Set(parentUris)];
  for (const parentUri of unique) {
    const thread = await getPostThread(parentUri, token);
    if (!thread?.post) continue;
    const parentPost = thread.post;
    const rootPost = getThreadRootPost(thread);
    const ancestorChain = walkAncestors(thread)
      .map((x) => x.author)
      .filter(Boolean);
    const upstreamAuthors = [
      ...new Set([...ancestorChain, parentPost.author?.handle].filter(Boolean)),
    ];
    const upstreamRelationshipClasses = Object.fromEntries(
      upstreamAuthors.map((
        author,
      ) => [author, getRelationshipClass(author)]),
    ) as Record<string, RelationshipClass>;
    map.set(parentUri, {
      parentAuthor: parentPost.author?.handle,
      rootAuthor: rootPost?.author?.handle,
      upstreamAuthors,
      upstreamRelationshipClasses,
      hasUnsafeUpstream: upstreamAuthors.some((author) =>
        (getRelationshipClass(author)) === "unsafe"
      ),
    });
  }
  return map;
}

function prettyPrintFeed(feed: any[], replyMap?: Map<string, ThreadContext>) {
  for (const item of feed) {
    const p = item.post;
    const reason = item.reason;
    const time = new Date(p.indexedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const prefix = reason ? `[repost by ${reason.by?.handle}]` : "";
    const likes = p.likeCount ?? 0;
    const replies = p.replyCount ?? 0;
    const handle = p.author?.handle || "?";
    const text = trunc(p.record?.text, 300);
    const alt = getEmbedAltText(item.post?.embed || item.embed);
    const reply = p.record?.reply;
    const replyContext = reply && replyMap
      ? replyMap.get(reply.parent?.uri)
      : undefined;
    console.log(`${time} ${handle} ${prefix}`);
    if (text) console.log(`  ${text}`);
    if (alt) console.log(`  ${alt.trim()}`);
    if (replyContext?.parentAuthor) {
      console.log(`  ↩ replying to @${replyContext.parentAuthor}`);
    }
    if (
      replyContext?.rootAuthor &&
      replyContext.rootAuthor !== replyContext.parentAuthor
    ) {
      console.log(`  ↑ thread root @${replyContext.rootAuthor}`);
    }
    if (replyContext?.upstreamAuthors?.length) {
      console.log(
        `  ↑ upstream ${
          replyContext.upstreamAuthors.map((a) =>
            `@${a}(${replyContext.upstreamRelationshipClasses[a] || "unsafe"})`
          ).join(" ← ")
        }`,
      );
    }
    if (replyContext?.hasUnsafeUpstream) {
      console.log(`  ! upstream includes unsafe people`);
    }
    console.log(`  ♥${likes} ↩${replies}  ${p.uri}`);
    console.log();
  }
}

function prettyPrintNotifs(
  notifs: any[],
  replyMap?: Map<string, ThreadContext>,
) {
  for (const x of notifs) {
    const time = new Date(x.indexedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const actor = x.author?.handle || "?";
    const text = trunc(x.record?.text, 120);
    const alt = getEmbedAltText(x.embeds?.[0]);
    const reason = x.reason;
    const reply = x.record?.reply;
    const replyContext = reply && replyMap
      ? replyMap.get(reply.parent?.uri)
      : undefined;
    console.log(`${time} [${reason}] ${actor}`);
    if (text) console.log(`  ${text}`);
    if (alt) console.log(`  ${alt.trim()}`);
    if (replyContext?.parentAuthor) {
      console.log(`  ↩ replying to @${replyContext.parentAuthor}`);
    }
    if (
      replyContext?.rootAuthor &&
      replyContext.rootAuthor !== replyContext.parentAuthor
    ) {
      console.log(`  ↑ thread root @${replyContext.rootAuthor}`);
    }
    if (replyContext?.upstreamAuthors?.length) {
      console.log(
        `  ↑ upstream ${
          replyContext.upstreamAuthors.map((a) =>
            `@${a}(${replyContext.upstreamRelationshipClasses[a] || "unsafe"})`
          ).join(" ← ")
        }`,
      );
    }
    if (replyContext?.hasUnsafeUpstream) {
      console.log(`  ! upstream includes unsafe people`);
    }
    console.log(`  ${x.uri}`);
    console.log();
  }
}

function getEmbedAltText(embed: any): string {
  if (!embed) return "";
  const images = embed.images || [];
  const alts = images.map((img: any) => img.alt).filter(Boolean);
  if (alts.length > 0) return "\n[image: " + alts.join("; ") + "]";
  return "";
}

function flattenThread(thread: any, depth = 0): any[] {
  const posts: any[] = [{
    author: thread.post?.author?.handle || thread.author?.handle,
    text: trunc((thread.post?.record?.text || "") + getEmbedAltText(thread.post?.embed)),
    time: thread.post?.indexedAt || thread.indexedAt,
    depth,
    uri: thread.post?.uri,
    cid: thread.post?.cid,
  }];
  for (const r of thread.replies || []) {
    posts.push(...flattenThread(r, depth + 1));
  }
  return posts;
}

function walkAncestors(thread: any): any[] {
  const out: any[] = [];
  let c = thread.parent;
  while (c?.post) {
    out.unshift({
      author: c.post.author?.handle,
      text: trunc((c.post.record?.text || "") + getEmbedAltText(c.post?.embed)),
      time: c.post.indexedAt,
      depth: -1,
      uri: c.post.uri,
      cid: c.post.cid,
      ancestor: true,
    });
    c = c.parent;
  }
  return out;
}

// --- richtext facets ---

async function buildFacets(text: string, token: string): Promise<any[]> {
  const facets: any[] = [];
  const encoder = new TextEncoder();
  const mentionRe = /@([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/g;
  let m;
  while ((m = mentionRe.exec(text)) !== null) {
    const matchStr = m[0];
    const handle = m[1];
    const res = await fetch(
      `${pdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
    );
    if (!res.ok) {
      console.error(`warning: could not resolve handle ${handle}`);
      continue;
    }
    const { did } = await res.json();
    const byteStart = byteOffset(text, m.index);
    const byteEnd = byteStart + encoder.encode(matchStr).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#mention", did }],
    });
  }
  const urlRe = /https?:\/\/[^\s)]+/g;
  while ((m = urlRe.exec(text)) !== null) {
    let matchStr = m[0].replace(/[.,;:!?]+$/, "");
    if (!matchStr) continue;
    const byteStart = byteOffset(text, m.index);
    const byteEnd = byteStart + encoder.encode(matchStr).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: matchStr }],
    });
  }
  return facets;
}

function byteOffset(str: string, charIdx: number): number {
  return new TextEncoder().encode(str.slice(0, charIdx)).length;
}

// --- resolve URI to CID ---

let myDid = "";

async function resolvePdsForDid(did: string): Promise<string> {
  let doc;
  if (isPlcDid(did)) {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) throw new Error(`failed to resolve did:plc ${did}`);
    doc = await res.json();
  } else if (isWebDid(did)) {
    const url = webDidToDocumentUrl(did);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to resolve did:web ${did}`);
    doc = await res.json();
  } else {
    throw new Error(`unsupported did method: ${did}`);
  }
  const pds = getPdsEndpoint(doc);
  if (!pds) throw new Error(`no pds endpoint found in ${did}`);
  return pds;
}

async function resolveCid(uri: string): Promise<string> {
  const m = uri.match(/at:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
  if (!m) throw new Error(`invalid uri: ${uri}`);
  const [, repo, collection, rkey] = m;
  const params =
    `repo=${encodeURIComponent(repo)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

  // if the repo is our own DID, use local PDS
  if (repo === myDid) {
    const res = await fetch(
      `${pdsUrl}/xrpc/com.atproto.repo.getRecord?${params}`,
    );
    if (res.ok) {
      const data = await res.json();
      if (data.cid) return data.cid;
    }
  }

  // resolve the record's home PDS directly via DID document
  const remotePds = await resolvePdsForDid(repo);
  const res = await fetch(
    `${remotePds}/xrpc/com.atproto.repo.getRecord?${params}`,
  );
  if (res.ok) {
    const data = await res.json();
    if (data.cid) return data.cid;
  }

  throw new Error(`failed to resolve cid for ${uri}`);
}

// --- resolve handle to DID ---

async function resolveHandle(handle: string): Promise<string> {
  // might already be a DID
  if (handle.startsWith("did:")) return handle;
  const res = await fetch(
    `${pdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
  );
  if (!res.ok) throw new Error(`could not resolve handle ${handle}`);
  const { did } = await res.json();
  return did;
}

// --- bsky chat (DM) helpers ---
// chat endpoints are proxied through the PDS with Atproto-Proxy header

const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";

async function chatFetch(path: string, token: string, init?: RequestInit): Promise<any> {
  const url = `${pdsUrl}/xrpc/${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Atproto-Proxy", CHAT_PROXY);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`chat api error: ${e.message || JSON.stringify(e)}`);
  }
  return await res.json();
}

// --- commands ---

const [cmd, ...rest] = Deno.args;
const jsonFlag = rest.includes("--json");
const limitArg = rest.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
const args = rest.filter((a) => a !== "--json" && !a.startsWith("--limit="));

try {
  const session = await auth();
  const token = session.accessJwt;
  const did = session.did;
  myDid = did;
  const client = readClient(token);

  switch (cmd) {
    case "check":
      console.log(`session ok: ${session.handle} (${did})`);
      break;

    case "feed": {
      const timeline = await ok(
        client.get("app.bsky.feed.getTimeline", {
          params: { limit: limit || 50 },
        }),
      );
      if (jsonFlag) {
        const replyMap = await hydrateReplyContext(timeline.feed, token);
        console.log(JSON.stringify(
          timeline.feed.map((p: any) => {
            const reply = p.post?.record?.reply;
            return formatPost(
              p,
              reply && replyMap ? replyMap.get(reply.parent?.uri) : undefined,
            );
          }),
          null,
          2,
        ));
      } else {
        const replyMap = await hydrateReplyContext(timeline.feed, token);
        prettyPrintFeed(timeline.feed, replyMap);
        cacheFeedItems(timeline.feed);
      }
      break;
    }

    case "user-feed": {
      const handle = args[0];
      const f = await ok(
        client.get("app.bsky.feed.getAuthorFeed", {
          params: { actor: handle as ActorIdentifier, limit: limit || 30 },
        }),
      );
      if (jsonFlag) {
        const replyMap = await hydrateReplyContext(f.feed, token);
        console.log(JSON.stringify(
          f.feed.map((p: any) => {
            const reply = p.post?.record?.reply;
            return formatPost(
              p,
              reply && replyMap ? replyMap.get(reply.parent?.uri) : undefined,
            );
          }),
          null,
          2,
        ));
      } else {
        const replyMap = await hydrateReplyContext(f.feed, token);
        prettyPrintFeed(f.feed, replyMap);
        cacheFeedItems(f.feed);
      }
      break;
    }

    case "custom-feed": {
      const uri = args[0];
      if (!uri) throw new Error("custom-feed requires a feed generator uri");
      const f = await ok(
        client.get("app.bsky.feed.getFeed", {
          params: { feed: uri as ResourceUri, limit: limit || 30 },
        }),
      );
      if (jsonFlag) {
        const replyMap = await hydrateReplyContext(f.feed, token);
        console.log(JSON.stringify(
          f.feed.map((p: any) => {
            const reply = p.post?.record?.reply;
            return formatPost(
              p,
              reply && replyMap ? replyMap.get(reply.parent?.uri) : undefined,
            );
          }),
          null,
          2,
        ));
      } else {
        const replyMap = await hydrateReplyContext(f.feed, token);
        prettyPrintFeed(f.feed, replyMap);
        cacheFeedItems(f.feed);
      }
      break;
    }

    case "notifications":
    case "notif": {
      const n = await ok(
        client.get("app.bsky.notification.listNotifications", {
          params: { limit: limit || 50 },
        }),
      );
      const replyMap = await hydrateReplyContext(n.notifications, token);
      if (jsonFlag) {
        console.log(JSON.stringify(
          n.notifications.map((x: any) => {
            const reply = x.record?.reply;
            const threadContext = reply && replyMap
              ? replyMap.get(reply.parent?.uri)
              : undefined;
            return {
              type: x.reason,
              actor: x.author?.handle,
              text: (x.record?.text || "") + getEmbedAltText(x.embeds?.[0]),
              time: x.indexedAt,
              uri: x.uri,
              cid: x.cid,
              replyTo: threadContext?.parentAuthor,
              rootAuthor: threadContext?.rootAuthor,
              upstreamAuthors: threadContext?.upstreamAuthors || [],
              upstreamRelationshipClasses:
                threadContext?.upstreamRelationshipClasses || {},
              hasUnsafeUpstream: threadContext?.hasUnsafeUpstream || false,
            };
          }),
          null,
          2,
        ));
      } else {
        prettyPrintNotifs(n.notifications, replyMap);
        cacheNotifItems(n.notifications);
      }
      break;
    }

    case "thread": {
      const uri = args[0];
      const t = await ok(
        client.get("app.bsky.feed.getPostThread", {
          params: { uri: uri as ResourceUri, depth: 6 },
        }),
      );
      console.log(
        JSON.stringify(
          [...walkAncestors(t.thread), ...flattenThread(t.thread)],
          null,
          2,
        ),
      );
      break;
    }

    case "profile": {
      const handle = args[0];
      const p = await ok(
        client.get("app.bsky.actor.getProfile", {
          params: { actor: handle as ActorIdentifier },
        }),
      );
      console.log(JSON.stringify(
        {
          handle: p.handle,
          did: p.did,
          displayName: p.displayName,
          description: p.description,
          followsCount: p.followsCount,
          followersCount: p.followersCount,
          postsCount: p.postsCount,
          labels: p.labels?.map((l: any) => l.val),
        },
        null,
        2,
      ));
      break;
    }

    case "set-bio": {
      const description = args.join(" ").trim();
      if (!description) {
        console.error("set-bio requires text");
        break;
      }
      const current = await getOwnProfile(session);
      const next = { ...current, description };
      await putOwnProfile(session, next);
      console.log("updated bio");
      break;
    }

    case "follow": {
      const handle = args[0];
      const subjectDid = await resolveHandle(handle);
      const r = await write(
        "app.bsky.graph.follow",
        {
          $type: "app.bsky.graph.follow",
          subject: subjectDid,
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      markInteraction(undefined, "acted", "followed", `followed ${handle}`);
      console.log("followed:", r.uri);
      break;
    }

    case "post": {
      const text = args.join(" ");
      const facets = await buildFacets(text, token);
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: ["en"],
      };
      if (facets.length > 0) record.facets = facets;
      const r = await write("app.bsky.feed.post", record, did, token);
      console.log("posted:", r.uri);
      break;
    }

    case "quote": {
      const quoteUriIdx = args.findIndex((a) => a.startsWith("at://"));
      let quoteUri: string | undefined;
      let quoteCid: string | undefined;
      if (quoteUriIdx !== -1) {
        quoteUri = args[quoteUriIdx];
        const maybeCid = args[quoteUriIdx + 1];
        if (maybeCid && maybeCid.startsWith("bafy")) {
          quoteCid = maybeCid;
        }
      }
      if (!quoteUri) throw new Error("quote requires an at:// uri of the post to quote");
      if (!quoteCid) {
        quoteCid = await resolveCid(quoteUri);
      }
      const textArgs = args.filter((a) => a !== quoteUri && a !== quoteCid);
      const text = textArgs.join(" ");
      const facets = await buildFacets(text, token);
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: ["en"],
        embed: {
          $type: "app.bsky.embed.record",
          record: { uri: quoteUri, cid: quoteCid },
        },
      };
      if (facets.length > 0) record.facets = facets;
      const r = await write("app.bsky.feed.post", record, did, token);
      console.log("quoted:", r.uri);
      break;
    }

    case "reply": {
      const [parentUri, second, ...rest] = args;
      if (!parentUri) throw new Error("reply requires at least parentUri");
      // if second arg looks like an at-uri, treat as optional root override; skip it
      const words = (second && second.startsWith("at://")) ? rest : (second ? [second, ...rest] : rest);
      const text = words.join(" ");
      const facets = await buildFacets(text, token);
      const refs = await resolveReplyRefs(parentUri, token);
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: ["en"],
        reply: refs,
      };
      if (facets.length > 0) record.facets = facets;
      const r = await write("app.bsky.feed.post", record, did, token);
      markInteraction(
        parentUri,
        "acted",
        "replied",
        `replied via bsky-client`,
        { reply_uri: r.uri },
      );
      console.log("replied:", r.uri);
      break;
    }

    case "like": {
      const [uri, cidArg] = args;
      if (!uri) throw new Error("like requires post uri");
      let cid = cidArg;
      if (!cid) {
        cid = await resolveCid(uri);
      }
      const r = await write(
        "app.bsky.feed.like",
        {
          $type: "app.bsky.feed.like",
          subject: { uri, cid },
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      markInteraction(
        uri,
        "acted",
        "liked",
        `liked via bsky-client`,
        { like_uri: r.uri },
      );
      console.log("liked:", r.uri);
      break;
    }

    case "cached":
    case "cached-search": {
      const query = cmd === "cached-search" ? args.join(" ").toLowerCase() : "";
      const cache = readFeedCache();
      if (cache.length === 0) {
        console.log("(no cached posts — run feed, notif, or user-feed first)");
        break;
      }
      for (const p of cache) {
        if (query && !p.text.toLowerCase().includes(query) && !p.author.toLowerCase().includes(query)) continue;
        const time = new Date(p.time).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          hour12: false, timeZone: "UTC",
        });
        const prefix = p.isRepost ? `[repost by ${p.repostedBy}]` : "";
        console.log(`#${p.index} ${p.author} ${prefix}`);
        if (p.text) console.log(`  ${trunc(p.text, 120)}`);
        console.log(`  ${time}  ♥${p.likes} ↩${p.replies}  ${p.uri}`);
        console.log();
      }
      break;
    }

    case "like-n": {
      const index = parseInt(args[0], 10);
      if (!index) throw new Error("like-n requires an index number");
      const post = getFromCache(index);
      if (!post) throw new Error(`no post at index ${index} in cache`);
      const r = await write(
        "app.bsky.feed.like",
        {
          $type: "app.bsky.feed.like",
          subject: { uri: post.uri, cid: post.cid },
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      markInteraction(
        post.uri,
        "acted",
        "liked",
        `liked via like-n #${index}`,
        { like_uri: r.uri },
      );
      console.log(`liked #${index}: ${post.author} — ${trunc(post.text, 60)}`);
      break;
    }

    case "reply-n": {
      const index = parseInt(args[0], 10);
      if (!index) throw new Error("reply-n requires an index number");
      const text = args.slice(1).join(" ");
      if (!text) throw new Error("reply-n requires text after the index");
      const post = getFromCache(index);
      if (!post) throw new Error(`no post at index ${index} in cache`);
      const { parent, root } = await resolveReplyRefs(post.uri, token);
      const facets = await buildFacets(text, token);
      const r = await write(
        "app.bsky.feed.post",
        {
          $type: "app.bsky.feed.post",
          text,
          facets,
          createdAt: new Date().toISOString(),
          reply: { root, parent },
        },
        did,
        token,
      );
      markInteraction(
        post.uri,
        "acted",
        "replied",
        `replied via reply-n #${index}`,
        { reply_uri: r.uri },
      );
      console.log(`replied #${index}: ${post.author} — "${text}"`);
      break;
    }

    case "delete": {
      const uri = args[0];
      const [, repo, collection, rkey] = uri.match(/at:\/\/(.+)\/(.+)\/(.+)/) ||
        [];
      if (!repo) {
        console.error("invalid uri");
        break;
      }
      const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ repo, collection, rkey }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(`delete failed: ${JSON.stringify(e)}`);
      }
      console.log("deleted:", uri);
      break;
    }

    case "dm-list": {
      // list all conversations
      const data = await chatFetch("chat.bsky.convo.listConvos?limit=50", token);
      const convos = data.convos || [];
      if (jsonFlag) {
        console.log(JSON.stringify(convos, null, 2));
      } else {
        if (convos.length === 0) {
          console.log("no conversations yet");
        } else {
          for (const c of convos) {
            const other = c.members?.find((m: any) => m.did !== did);
            const handle = other?.handle || other?.did || "?";
            const name = other?.displayName || "";
            const unread = c.unreadCount || 0;
            const status = c.status || "open";
            const label = unread > 0 ? ` (${unread} unread)` : "";
            console.log(`[${c.id}] ${name ? name + " " : ""}@${handle}${label} [${status}]`);
          }
        }
      }
      break;
    }

    case "dm-messages": {
      // get messages from a conversation
      const convoId = args[0];
      if (!convoId) throw new Error("dm-messages requires a conversation id");
      const msgLimit = limit || 30;
      const data = await chatFetch(`chat.bsky.convo.getMessages?convoId=${convoId}&limit=${msgLimit}`, token);
      const msgs = data.messages || [];
      if (jsonFlag) {
        console.log(JSON.stringify(msgs, null, 2));
      } else {
        for (const m of msgs) {
          const sender = m.sender?.handle || m.sender?.did || "?";
          const me = m.sender?.did === did;
          const prefix = me ? "me" : sender;
          const time = m.sentAt ? new Date(m.sentAt).toLocaleString() : "";
          console.log(`[${time}] ${prefix}: ${m.text || "(no text)"}`);
        }
      }
      break;
    }

    case "dm-send": {
      // send a DM to a handle/did
      const recipient = args[0];
      const text = args.slice(1).join(" ");
      if (!recipient || !text) throw new Error("usage: dm-send <handle|did> <text>");
      const recipientDid = await resolveHandle(recipient);
      // get or create convo
      let convoId: string;
      try {
        const convoData = await chatFetch(
          `chat.bsky.convo.getConvoForMembers?members=${recipientDid}`, token,
        );
        convoId = convoData.convo.id;
      } catch {
        throw new Error(`could not start conversation with ${recipient}: they may have DMs restricted`);
      }
      const msgData = await chatFetch("chat.bsky.convo.sendMessage", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convoId,
          message: {
            text,
            createdAt: new Date().toISOString(),
            "$type": "chat.bsky.convo.defs#messageInput",
          },
        }),
      });
      console.log(`sent to ${recipient} (convo ${convoId}): ${text}`);
      console.log(`message id: ${msgData.id}`);
      break;
    }

    case "dm-reply": {
      // send a DM in an existing conversation
      const convoId = args[0];
      const text = args.slice(1).join(" ");
      if (!convoId || !text) throw new Error("usage: dm-reply <convo-id> <text>");
      const msgData = await chatFetch("chat.bsky.convo.sendMessage", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convoId,
          message: {
            text,
            createdAt: new Date().toISOString(),
            "$type": "chat.bsky.convo.defs#messageInput",
          },
        }),
      });
      console.log(`sent in convo ${convoId}: ${text}`);
      console.log(`message id: ${msgData.id}`);
      break;
    }

    default:
      console.error("usage: bsky <command> [args...] [--json]");
      console.error(
        "commands: check, feed, user-feed, custom-feed, notif, thread, profile, set-bio, follow, post, quote, reply, like, delete",
      );
      console.error(
        "  dm-list, dm-messages, dm-send, dm-reply: bsky DM support",
      );
      console.error(
        "  feed, user-feed, custom-feed, notif: pretty-print by default, --json for raw",
      );
      Deno.exit(1);
  }
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  Deno.exit(1);
}
