import { configuredCustomFeedUri, DB_PATH, getSelfHandle } from "./config.ts";
import {
  extractStoredAltText,
  extractStoredPostText,
} from "./cache.ts";
import {
  getTrackedItem,
  insertItem,
  loadRelationshipLookup,
  openDb,
} from "./db.ts";
import type {
  Action,
  FormattedFeedItem,
  FormattedNotifItem,
  ItemKind,
  ScanItem,
  ScanSummary,
  Status,
} from "./types.ts";
import {
  fetchCustomFeedView,
  fetchNotificationsView,
  fetchTimelineView,
  getPostByUri,
  hydrateReplyContext,
} from "./read.ts";
import { getAuthedClient } from "./auth.ts";
import { upsertManualItem } from "./db.ts";
import { fetchHydrantPosts, type HydrantPost } from "./hydrant.ts";

function inferKind(
  item: FormattedFeedItem | FormattedNotifItem,
  source: ScanItem["source"],
): ItemKind {
  if (source === "notif") {
    if (item.type === "reply") return "reply";
    if (item.type === "mention") return "mention";
    if (item.type === "like") return "like";
    if (item.type === "follow") return "follow";
    if (item.type === "repost") return "repost";
    return "system";
  }
  if ("parentUri" in item && item.parentUri) return "reply";
  return "post";
}

function safetyOfUpstream(
  upstreamRelationshipClasses: Record<string, "oomf" | "safe" | "unsafe">,
  hasUnsafeUpstream: boolean,
) {
  if (hasUnsafeUpstream) return "unsafe";
  const classes = Object.values(upstreamRelationshipClasses);
  if (classes.length === 0) return null;
  if (classes.includes("unsafe")) return "unsafe";
  if (classes.includes("safe")) return "safe";
  if (classes.includes("oomf")) return "oomf";
  return null;
}

function computeNeedsAttention(item: Omit<ScanItem, "needs_attention">) {
  const selfHandle = getSelfHandle();
  if (item.source === "notif") {
    if (
      item.kind === "reply" || item.kind === "mention" || item.kind === "follow"
    ) return 1;
    return 0;
  }
  if (item.author_handle === selfHandle) return 0;
  if (item.reply_to === selfHandle) return 1;
  if (item.root_author === selfHandle) return 1;
  return 0;
}

export function computeInitialStatus(item: ScanItem): Status {
  const selfHandle = getSelfHandle();
  if (item.needs_attention) return "pending";
  if (item.source === "notif") return "seen";
  if (item.author_handle === selfHandle) return "seen";
  if (item.has_unsafe_upstream) return "seen";
  return "ambient";
}

function normalizeFeedItem(item: FormattedFeedItem, source: ScanItem["source"]) {
  const base = {
    uri: item.uri,
    cid: item.cid || null,
    source,
    kind: inferKind(item, source) as ItemKind,
    author_handle: item.author || null,
    author_did: item.authorDid || null,
    text: extractStoredPostText(item.text) || null,
    alt_text: extractStoredAltText(item.text) || null,
    created_at: item.time || null,
    indexed_at: item.time || null,
    thread_root_uri: item.threadRootUri || null,
    parent_uri: item.parentUri || null,
    reply_to: item.replyTo || null,
    root_author: item.rootAuthor || null,
    subject_uri: null,
    subject_cid: null,
    subject_did: null,
    subject_handle: null,
    upstream_safety: safetyOfUpstream(
      item.upstreamRelationshipClasses,
      item.hasUnsafeUpstream,
    ),
    has_unsafe_upstream: item.hasUnsafeUpstream ? 1 : 0,
    raw_json: JSON.stringify(item),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) } satisfies ScanItem;
}

function normalizeNotifItem(item: FormattedNotifItem) {
  const base = {
    uri: item.uri,
    cid: item.cid || null,
    source: "notif" as const,
    kind: inferKind(item, "notif") as ItemKind,
    author_handle: item.actor || null,
    author_did: item.actorDid || null,
    text: extractStoredPostText(item.text) || null,
    alt_text: extractStoredAltText(item.text) || null,
    created_at: item.time || null,
    indexed_at: item.time || null,
    thread_root_uri: item.threadRootUri || null,
    parent_uri: item.parentUri || null,
    reply_to: item.replyTo || null,
    root_author: item.rootAuthor || null,
    subject_uri: null,
    subject_cid: null,
    subject_did: null,
    subject_handle: null,
    upstream_safety: safetyOfUpstream(
      item.upstreamRelationshipClasses,
      item.hasUnsafeUpstream,
    ),
    has_unsafe_upstream: item.hasUnsafeUpstream ? 1 : 0,
    raw_json: JSON.stringify(item),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) } satisfies ScanItem;
}

function normalizeHydrantItem(item: HydrantPost) {
  const base = {
    uri: item.uri,
    cid: item.cid || null,
    source: "hydrant" as const,
    kind: item.parentUri ? "reply" as const : "post" as const,
    author_handle: item.handle || null,
    author_did: item.author || null,
    text: extractStoredPostText(item.text) || null,
    alt_text: extractStoredAltText(item.text) || null,
    created_at: item.time || null,
    indexed_at: item.time || null,
    thread_root_uri: item.threadRootUri || null,
    parent_uri: item.parentUri || null,
    reply_to: null,
    root_author: null,
    subject_uri: null,
    subject_cid: null,
    subject_did: null,
    subject_handle: null,
    upstream_safety: null,
    has_unsafe_upstream: 0,
    raw_json: JSON.stringify(item.raw),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) } satisfies ScanItem;
}

function withinMinutes(timestamp: string | null | undefined, minutes: number) {
  if (!timestamp || minutes <= 0) return true;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return true;
  return time >= Date.now() - minutes * 60 * 1000;
}

function dedupeKey(item: ScanItem) {
  return item.cid || item.uri;
}

export async function snapshotPostForState(
  uri: string,
  token: string,
): Promise<ScanItem | null> {
  const post = await getPostByUri(uri, token);
  if (!post?.uri) return null;

  let threadContext;
  const reply = post.record?.reply;
  if (reply?.parent?.uri) {
    threadContext = (await hydrateReplyContext([{ post }], token)).get(
      reply.parent.uri,
    );
  }

  const base = {
    uri: post.uri,
    cid: post.cid || null,
    source: "manual" as const,
    kind: reply ? "reply" as const : "post" as const,
    author_handle: post.author?.handle || null,
    author_did: post.author?.did || null,
    text: post.record?.text || null,
    alt_text: null,
    created_at: post.record?.createdAt || post.indexedAt || null,
    indexed_at: post.indexedAt || post.record?.createdAt || null,
    thread_root_uri: reply?.root?.uri || threadContext?.threadRootUri || null,
    parent_uri: reply?.parent?.uri || threadContext?.parentUri || null,
    reply_to: threadContext?.parentAuthor || null,
    root_author: threadContext?.rootAuthor || null,
    subject_uri: null,
    subject_cid: null,
    subject_did: null,
    subject_handle: null,
    upstream_safety: safetyOfUpstream(
      threadContext?.upstreamRelationshipClasses || {},
      threadContext?.hasUnsafeUpstream || false,
    ),
    has_unsafe_upstream: threadContext?.hasUnsafeUpstream ? 1 : 0,
    raw_json: JSON.stringify(post),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) };
}

export async function markTrackedAction(
  targetUri: string,
  action: Extract<Action, "liked" | "replied">,
  note: string,
  token: string,
  extras: {
    like_uri?: string | null;
    like_cid?: string | null;
    reply_uri?: string | null;
    reply_cid?: string | null;
  } = {},
) {
  const db = openDb();
  try {
    const now = new Date().toISOString();
    const existing = getTrackedItem(db, targetUri);
    if (!existing) {
      const snapshot = await snapshotPostForState(targetUri, token);
      if (snapshot) insertItem(db, snapshot, computeInitialStatus(snapshot));
    }

    const seeded = getTrackedItem(db, targetUri);
    if (!seeded) {
      db.query(
        `insert into items (
          uri, cid, source, kind, first_seen_at, last_seen_at, status, action_taken,
          decision_note, last_decision_at, like_uri, like_cid, reply_uri, reply_cid,
          raw_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetUri,
          null,
          "manual",
          "post",
          now,
          now,
          "acted",
          action,
          note,
          now,
          extras.like_uri ?? null,
          extras.like_cid ?? null,
          extras.reply_uri ?? null,
          extras.reply_cid ?? null,
          "{}",
        ],
      );
      return;
    }

    db.query(
      `update items
       set status = 'acted',
           action_taken = ?,
           decision_note = ?,
           last_decision_at = ?,
           last_seen_at = ?,
           like_uri = coalesce(?, like_uri),
           like_cid = coalesce(?, like_cid),
           reply_uri = coalesce(?, reply_uri),
           reply_cid = coalesce(?, reply_cid)
       where uri = ?`,
      [
        action,
        note,
        now,
        now,
        extras.like_uri ?? null,
        extras.like_cid ?? null,
        extras.reply_uri ?? null,
        extras.reply_cid ?? null,
        targetUri,
      ],
    );
  } finally {
    db.close();
  }
}

export async function scan(minutes = 180): Promise<ScanSummary> {
  const selfHandle = getSelfHandle() ?? "";
  let authed:
    | Awaited<ReturnType<typeof getAuthedClient>>
    | null = null;
  try {
    authed = await getAuthedClient();
  } catch {
    authed = null;
  }

  const requests: PromiseSettledResult<any>[] = await Promise.allSettled([
    authed ? fetchTimelineView(authed.client, authed.token, 80) : Promise.resolve(null),
    authed
      ? fetchNotificationsView(authed.client, authed.token, 80)
      : Promise.resolve(null),
    configuredCustomFeedUri && authed
      ? fetchCustomFeedView(authed.client, authed.token, configuredCustomFeedUri, 60)
      : Promise.resolve(null),
    fetchHydrantPosts(minutes),
  ]);

  const [feedResult, notifResult, customFeedResult, hydrantResult] = requests;
  const feedView = feedResult.status === "fulfilled" ? feedResult.value : null;
  const notifView = notifResult.status === "fulfilled" ? notifResult.value : null;
  const customFeedView = customFeedResult.status === "fulfilled"
    ? customFeedResult.value
    : null;
  const hydrantPosts = hydrantResult.status === "fulfilled" ? hydrantResult.value : [];

  const items: ScanItem[] = [
    ...(feedView
      ? feedView.formatted
        .filter((item: FormattedFeedItem) => withinMinutes(item.time, minutes))
        .map((item: FormattedFeedItem) => normalizeFeedItem(item, "feed"))
      : []),
    ...(notifView
      ? notifView.formatted
        .filter((item: FormattedNotifItem) => withinMinutes(item.time, minutes))
        .map((item: FormattedNotifItem) => normalizeNotifItem(item))
      : []),
    ...(customFeedView
      ? customFeedView.formatted
        .filter((item: FormattedFeedItem) => withinMinutes(item.time, minutes))
        .map((item: FormattedFeedItem) =>
          normalizeFeedItem(item, "custom-feed")
        )
      : []),
    ...hydrantPosts.map((item: HydrantPost) => normalizeHydrantItem(item)),
  ];

  const deduped = new Map<string, ScanItem>();
  for (const item of items) {
    const key = dedupeKey(item);
    const prev = deduped.get(key);
    if (!prev || (item.source === "notif" && prev.source !== "notif")) {
      deduped.set(key, item);
    }
  }

  const db = openDb();
  let inserted = 0;
  let updated = 0;
  let autoPending = 0;
  let autoSeen = 0;
  const now = new Date().toISOString();

  try {
    for (const item of deduped.values()) {
      const existing = getTrackedItem(db, item.uri);
      const initialStatus = computeInitialStatus(item);

      if (!existing) {
        insertItem(db, item, initialStatus);
        inserted++;
        if (initialStatus === "pending") autoPending++;
        else autoSeen++;
        continue;
      }

      db.query(
        `update items set
          cid = ?,
          source = ?,
          kind = ?,
          author_handle = ?,
          author_did = ?,
          text = ?,
          alt_text = ?,
          created_at = ?,
          indexed_at = ?,
          thread_root_uri = ?,
          parent_uri = ?,
          reply_to = ?,
          root_author = ?,
          subject_uri = coalesce(subject_uri, ?),
          subject_cid = coalesce(subject_cid, ?),
          subject_did = coalesce(subject_did, ?),
          subject_handle = coalesce(subject_handle, ?),
          upstream_safety = ?,
          has_unsafe_upstream = ?,
          needs_attention = ?,
          last_seen_at = ?,
          raw_json = ?,
          status = case
            when status in ('acted', 'handled', 'ignored', 'seen') then status
            when ? = 1 then 'pending'
            when ? = 'notif' then 'seen'
            when ? = ? then 'seen'
            when ? = 1 then 'seen'
            else 'ambient'
          end
        where uri = ?`,
        [
          item.cid,
          item.source,
          item.kind,
          item.author_handle,
          item.author_did,
          item.text,
          item.alt_text,
          item.created_at,
          item.indexed_at,
          item.thread_root_uri,
          item.parent_uri,
          item.reply_to,
          item.root_author,
          item.subject_uri,
          item.subject_cid,
          item.subject_did,
          item.subject_handle,
          item.upstream_safety,
          item.has_unsafe_upstream,
          item.needs_attention,
          now,
          item.raw_json,
          item.needs_attention,
          item.source,
          item.author_handle,
          selfHandle,
          item.has_unsafe_upstream,
          item.uri,
        ],
      );
      updated++;
    }
  } finally {
    db.close();
  }

  return {
    scanned: deduped.size,
    inserted,
    updated,
    autoPending,
    autoSeen,
    db: DB_PATH,
  };
}

export function listPending() {
  const db = openDb();
  const rows = [...db.queryEntries(
    `select uri, cid, source, kind, author_handle, reply_to, root_author, text,
            alt_text, created_at, status, action_taken, decision_note,
            needs_attention, upstream_safety, parent_uri, thread_root_uri,
            subject_uri, subject_handle
     from items
     where status = 'pending'
     order by coalesce(created_at, last_seen_at) desc
     limit 40`,
  )];
  db.close();
  return rows;
}

export function listAmbient() {
  const db = openDb();
  const rows = [...db.queryEntries(
    `select uri, cid, source, kind, author_handle, reply_to, root_author, text,
            alt_text, created_at, status, action_taken, decision_note,
            needs_attention, upstream_safety, parent_uri, thread_root_uri,
            subject_uri, subject_handle
     from items
     where status = 'ambient'
     order by coalesce(created_at, last_seen_at) desc
     limit 40`,
  )];
  db.close();
  return rows;
}

export function listAmbientShort() {
  const selfHandle = getSelfHandle() ?? "";
  const db = openDb();
  const rows = [...db.queryEntries(
    `select uri, source, kind, author_handle, reply_to, root_author, text,
            alt_text, created_at, upstream_safety, parent_uri, thread_root_uri,
            subject_uri, subject_handle
     from items
     where status = 'ambient'
       and datetime(coalesce(created_at, last_seen_at)) >= datetime('now', '-12 hours')
     order by
       case
         when author_handle in (
           select handle from relationships
           where trust = 'oomf'
             and handle != 'null.namespaces.me'
             and handle != ?
         ) then 0
         when author_handle = 'null.namespaces.me'
           and coalesce(reply_to, '') = 'null.namespaces.me' then 2
         when author_handle = 'null.namespaces.me' then 1
         else 3
       end,
       coalesce(created_at, last_seen_at) desc
     limit 12`,
    [selfHandle],
  )];
  db.close();
  return rows;
}

export async function heartbeat(minutes = 180) {
  const summary = await scan(minutes);
  return {
    scan: summary,
    pending: listPending().slice(0, 20),
    ambient: listAmbientShort(),
  };
}

export function mark(uri: string, status: Status, note = "", action: Action = "none") {
  const db = openDb();
  const now = new Date().toISOString();
  db.query(
    `update items
     set status = ?, action_taken = ?, decision_note = ?, last_decision_at = ?
     where uri = ?`,
    [status, action, note || null, now, uri],
  );
  db.close();
  return { ok: true, uri, status, action, note };
}

export function cleanupPending() {
  const db = openDb();
  const now = new Date().toISOString();
  db.query(
    `update items
     set status = 'seen',
         last_decision_at = ?,
         decision_note = coalesce(
           decision_note,
           'auto cleanup: stale pending demoted to seen'
         )
     where status = 'pending'
       and (
         action_taken != 'none'
         or datetime(coalesce(created_at, last_seen_at)) < datetime('now', '-6 hours')
       )`,
    [now],
  );
  const changed = [...db.queryEntries<{ count: number }>(
    `select changes() as count`,
  )][0]?.count || 0;
  db.close();
  return { ok: true, cleaned: changed };
}

export function reclassifyStale() {
  const db = openDb();
  const trustMap = loadRelationshipLookup(db);
  let fixed = 0;
  let promoted = 0;

  const items = [...db.queryEntries<{
    uri: string;
    author_handle: string | null;
    has_unsafe_upstream: number;
    status: string;
    upstream_safety: string | null;
  }>(
    "select uri, author_handle, has_unsafe_upstream, status, upstream_safety from items",
  )];

  for (const item of items) {
    const trust = item.author_handle
      ? trustMap.get(item.author_handle.toLowerCase())
      : undefined;
    if (!trust) continue;
    if (
      trust !== "unsafe" &&
      item.has_unsafe_upstream === 1 &&
      item.upstream_safety === "unsafe"
    ) {
      db.query(
        `update items
         set has_unsafe_upstream = 0, upstream_safety = ?
         where uri = ?`,
        [trust === "oomf" ? "oomf" : "safe", item.uri],
      );
      fixed++;
      if (item.status === "seen") {
        db.query(
          `update items
           set status = 'ambient'
           where uri = ?
             and status = 'seen'
             and source not in ('notif')`,
          [item.uri],
        );
        promoted++;
      }
    }
  }

  db.close();
  return { ok: true, fixed, promoted };
}

export { upsertManualItem };
