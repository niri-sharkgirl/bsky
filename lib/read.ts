import { Client, ok } from "npm:@atcute/client@4.2.1";
import type { ActorIdentifier, ResourceUri } from "npm:@atcute/lexicons@1.2.9";
import type {} from "npm:@atcute/bluesky@3.3.3";
import { pdsUrl } from "./config.ts";
import {
  cacheFeedItems,
  cacheNotifItems,
  getEmbedAltText,
  trunc,
} from "./cache.ts";
import { getRelationshipClass, loadRelationshipLookup, openDb } from "./db.ts";
import type {
  FormattedFeedItem,
  FormattedNotifItem,
  RelationshipClass,
  ThreadContext,
} from "./types.ts";

export async function getPostThread(
  uri: string,
  token: string,
): Promise<any | undefined> {
  try {
    const res = await fetch(
      `${pdsUrl}/xrpc/app.bsky.feed.getPostThread?uri=${
        encodeURIComponent(uri)
      }&depth=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.thread;
  } catch {
    return undefined;
  }
}

export async function getPostByUri(
  uri: string,
  token: string,
): Promise<any | null> {
  const res = await fetch(
    `${pdsUrl}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.posts?.[0] ?? null;
}

function getThreadRootPost(thread: any) {
  let current = thread;
  while (current?.parent?.post) current = current.parent;
  return current?.post;
}

export function walkAncestors(thread: any) {
  const out: any[] = [];
  let current = thread.parent;
  while (current?.post) {
    out.unshift({
      author: current.post.author?.handle,
      text: trunc(
        (current.post.record?.text || "") + getEmbedAltText(current.post?.embed),
      ),
      time: current.post.indexedAt,
      depth: -1,
      uri: current.post.uri,
      cid: current.post.cid,
      ancestor: true,
    });
    current = current.parent;
  }
  return out;
}

export function walkLinearChain(thread: any): any[] {
  // walk from target post up to root via parent refs, return root→target order
  const chain: any[] = [];
  let current: any = thread;
  while (current?.post) {
    chain.unshift({
      author: current.post.author?.handle,
      text: trunc(
        (current.post.record?.text || "") + getEmbedAltText(current.post?.embed),
      ),
      time: current.post.indexedAt,
      depth: chain.length,
      uri: current.post.uri,
      cid: current.post.cid,
    });
    current = current.parent;
  }
  return chain;
}

export function flattenThread(thread: any, depth = 0): any[] {
  const posts: any[] = [{
    author: thread.post?.author?.handle || thread.author?.handle,
    text: trunc(
      (thread.post?.record?.text || "") + getEmbedAltText(thread.post?.embed),
    ),
    time: thread.post?.indexedAt || thread.indexedAt,
    depth,
    uri: thread.post?.uri,
    cid: thread.post?.cid,
  }];
  for (const reply of thread.replies || []) {
    posts.push(...flattenThread(reply, depth + 1));
  }
  return posts;
}

function getReplyRecord(item: any) {
  return item?.post?.record?.reply || item?.record?.reply;
}

export async function hydrateReplyContext(
  items: any[],
  token: string,
): Promise<Map<string, ThreadContext>> {
  const parentUris: string[] = [];
  for (const item of items) {
    const reply = getReplyRecord(item);
    if (reply?.parent?.uri) parentUris.push(reply.parent.uri);
  }
  if (parentUris.length === 0) return new Map();

  const db = openDb();
  const relationshipMap = loadRelationshipLookup(db);
  db.close();

  const map = new Map<string, ThreadContext>();
  for (const parentUri of [...new Set(parentUris)]) {
    const thread = await getPostThread(parentUri, token);
    if (!thread?.post) continue;
    const parentPost = thread.post;
    const rootPost = getThreadRootPost(thread);
    const ancestorChain = walkAncestors(thread)
      .map((ancestor) => ancestor.author)
      .filter(Boolean);
    const upstreamAuthors = [
      ...new Set([...ancestorChain, parentPost.author?.handle].filter(Boolean)),
    ];
    const upstreamRelationshipClasses = Object.fromEntries(
      upstreamAuthors.map((author) => [
        author,
        getRelationshipClass(relationshipMap, author),
      ]),
    ) as Record<string, RelationshipClass>;
    map.set(parentUri, {
      parentUri: parentPost.uri,
      parentAuthor: parentPost.author?.handle,
      threadRootUri: rootPost?.uri,
      rootAuthor: rootPost?.author?.handle,
      upstreamAuthors,
      upstreamRelationshipClasses,
      hasUnsafeUpstream: upstreamAuthors.some((author) =>
        getRelationshipClass(relationshipMap, author) === "unsafe"
      ),
    });
  }
  return map;
}

function formatPost(item: any, threadContext?: ThreadContext): FormattedFeedItem {
  const reason = item.reason;
  const reply = item.post.record?.reply;
  const postText = item.post.record?.text || "";
  const altText = getEmbedAltText(item.post?.embed);
  return {
    type: reason
      ? `${reason.$type?.split(".").pop() || "repost"} by ${reason.by?.handle}`
      : "post",
    author: item.post.author?.handle || null,
    authorDid: item.post.author?.did || null,
    text: trunc(postText + altText),
    time: item.post.indexedAt || item.post.record?.createdAt || null,
    likes: item.post.likeCount ?? 0,
    replies: item.post.replyCount ?? 0,
    uri: item.post.uri,
    cid: item.post.cid,
    parentUri: reply?.parent?.uri || null,
    threadRootUri: reply?.root?.uri || threadContext?.threadRootUri || null,
    replyTo: threadContext?.parentAuthor || null,
    rootAuthor: threadContext?.rootAuthor || null,
    upstreamAuthors: threadContext?.upstreamAuthors || [],
    upstreamRelationshipClasses:
      threadContext?.upstreamRelationshipClasses || {},
    hasUnsafeUpstream: threadContext?.hasUnsafeUpstream || false,
  };
}

function formatNotification(
  item: any,
  threadContext?: ThreadContext,
): FormattedNotifItem {
  const reply = item.record?.reply;
  return {
    type: item.reason,
    actor: item.author?.handle || null,
    actorDid: item.author?.did || null,
    text: (item.record?.text || "") + getEmbedAltText(item.embeds?.[0]),
    time: item.indexedAt || null,
    uri: item.uri,
    cid: item.cid || null,
    parentUri: reply?.parent?.uri || null,
    threadRootUri: reply?.root?.uri || threadContext?.threadRootUri || null,
    replyTo: threadContext?.parentAuthor || null,
    rootAuthor: threadContext?.rootAuthor || null,
    upstreamAuthors: threadContext?.upstreamAuthors || [],
    upstreamRelationshipClasses:
      threadContext?.upstreamRelationshipClasses || {},
    hasUnsafeUpstream: threadContext?.hasUnsafeUpstream || false,
  };
}

export async function fetchTimelineView(
  client: Client,
  token: string,
  limit: number,
) {
  const timeline = await ok(
    client.get("app.bsky.feed.getTimeline", {
      params: { limit },
    }),
  );
  const replyMap = await hydrateReplyContext(timeline.feed, token);
  return {
    raw: timeline.feed,
    formatted: timeline.feed.map((item: any) => {
      const reply = item.post?.record?.reply;
      return formatPost(
        item,
        reply ? replyMap.get(reply.parent?.uri) : undefined,
      );
    }),
  };
}

export async function fetchAuthorFeedView(
  client: Client,
  token: string,
  handle: string,
  limit: number,
) {
  const feed = await ok(
    client.get("app.bsky.feed.getAuthorFeed", {
      params: { actor: handle as ActorIdentifier, limit },
    }),
  );
  const replyMap = await hydrateReplyContext(feed.feed, token);
  return {
    raw: feed.feed,
    formatted: feed.feed.map((item: any) => {
      const reply = item.post?.record?.reply;
      return formatPost(
        item,
        reply ? replyMap.get(reply.parent?.uri) : undefined,
      );
    }),
  };
}

export async function fetchCustomFeedView(
  client: Client,
  token: string,
  feedUri: string,
  limit: number,
) {
  const feed = await ok(
    client.get("app.bsky.feed.getFeed", {
      params: { feed: feedUri as ResourceUri, limit },
    }),
  );
  const replyMap = await hydrateReplyContext(feed.feed, token);
  return {
    raw: feed.feed,
    formatted: feed.feed.map((item: any) => {
      const reply = item.post?.record?.reply;
      return formatPost(
        item,
        reply ? replyMap.get(reply.parent?.uri) : undefined,
      );
    }),
  };
}

export async function fetchNotificationsView(
  client: Client,
  token: string,
  limit: number,
) {
  const notifications = await ok(
    client.get("app.bsky.notification.listNotifications", {
      params: { limit },
    }),
  );
  const replyMap = await hydrateReplyContext(notifications.notifications, token);
  return {
    raw: notifications.notifications,
    formatted: notifications.notifications.map((item: any) => {
      const reply = item.record?.reply;
      return formatNotification(
        item,
        reply ? replyMap.get(reply.parent?.uri) : undefined,
      );
    }),
  };
}

const NOISY_BOTS = new Set(["bot-tan.suibari.com"]);

export async function printFeedView(view: { raw: any[] }, token: string) {
  const replyMap = await hydrateReplyContext(view.raw, token);
  for (const item of view.raw) {
    const post = item.post;
    const reason = item.reason;
    const time = new Date(post.indexedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const prefix = reason ? `[repost by ${reason.by?.handle}]` : "";
    const likes = post.likeCount ?? 0;
    const replies = post.replyCount ?? 0;
    const handle = post.author?.handle || "?";
    const text = trunc(post.record?.text, 300);
    const alt = getEmbedAltText(post.embed);
    const reply = post.record?.reply;
    const replyContext = reply && replyMap
      ? replyMap.get(reply.parent?.uri)
      : undefined;
    // suppress noisy bots unless they're replying to someone we trust
    if (NOISY_BOTS.has(handle)) {
      if (replyContext?.upstreamRelationshipClasses) {
        const hasKnownUpstream = Object.values(replyContext.upstreamRelationshipClasses)
          .some((cls) => cls === "oomf" || cls === "safe");
        if (!hasKnownUpstream) continue;
      } else {
        continue;
      }
    }
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
          replyContext.upstreamAuthors.map((author) =>
            `@${author}(${replyContext.upstreamRelationshipClasses[author] || "unsafe"})`
          ).join(" ← ")
        }`,
      );
    }
    if (replyContext?.hasUnsafeUpstream) {
      console.log("  ! upstream includes unsafe people");
    }
    console.log(`  ♥${likes} ↩${replies}  ${post.uri}`);
    console.log();
  }
  cacheFeedItems(view.raw);
}

export async function printNotifView(view: { raw: any[] }, token: string) {
  const replyMap = await hydrateReplyContext(view.raw, token);
  for (const item of view.raw) {
    const time = new Date(item.indexedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    const actor = item.author?.handle || "?";
    const text = trunc(item.record?.text, 120);
    const alt = getEmbedAltText(item.embeds?.[0]);
    const reply = item.record?.reply;
    const replyContext = reply && replyMap
      ? replyMap.get(reply.parent?.uri)
      : undefined;
    console.log(`${time} [${item.reason}] ${actor}`);
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
          replyContext.upstreamAuthors.map((author) =>
            `@${author}(${replyContext.upstreamRelationshipClasses[author] || "unsafe"})`
          ).join(" ← ")
        }`,
      );
    }
    if (replyContext?.hasUnsafeUpstream) {
      console.log("  ! upstream includes unsafe people");
    }
    console.log(`  ${item.uri}`);
    console.log();
  }
  cacheNotifItems(view.raw);
}
