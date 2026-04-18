import { CACHE_PATH } from "./config.ts";
import type { CachedPost } from "./types.ts";

export function trunc(text: string | undefined | null, length = 2000) {
  return text?.slice(0, length) || "";
}

export function byteOffset(text: string, charIndex: number) {
  return new TextEncoder().encode(text.slice(0, charIndex)).length;
}

export function getEmbedAltText(embed: any): string {
  if (!embed) return "";
  const images = embed.images || embed.media?.images || [];
  const alts = images.map((image: any) => image.alt).filter(Boolean);
  if (alts.length > 0) {
    return "\n[image: " + alts.join("; ") + "]";
  }
  return "";
}

export function extractStoredPostText(text: string | null) {
  if (!text) return null;
  const idx = text.indexOf("\n[image: ");
  return idx >= 0 ? text.slice(0, idx).trim() || null : text;
}

export function extractStoredAltText(text: string | null) {
  if (!text) return null;
  const match = text.match(/\n\[image: (.+)\]$/s);
  return match ? match[1] : null;
}

export function writeFeedCache(posts: CachedPost[]) {
  Deno.writeTextFileSync(CACHE_PATH, JSON.stringify(posts, null, 2));
}

export function readFeedCache(): CachedPost[] {
  try {
    return JSON.parse(Deno.readTextFileSync(CACHE_PATH));
  } catch {
    return [];
  }
}

export function getFromCache(index: number): CachedPost | undefined {
  return readFeedCache().find((post) => post.index === index);
}

export function cacheFeedItems(items: any[], startAt = 1) {
  const posts: CachedPost[] = items
    .map((item: any, i: number) => {
      const post = item.post;
      const reason = item.reason;
      return {
        index: startAt + i,
        uri: post?.uri || item.uri || "",
        cid: post?.cid || item.cid || "",
        author: post?.author?.handle || item.author?.handle || "?",
        text: trunc(
          (post?.record?.text || item.record?.text || "") +
            getEmbedAltText(post?.embed || item.embed),
        ),
        time: post?.indexedAt || item.indexedAt || "",
        likes: post?.likeCount ?? item.likeCount ?? 0,
        replies: post?.replyCount ?? item.replyCount ?? 0,
        isRepost: !!reason,
        repostedBy: reason?.by?.handle,
      };
    })
    .filter((post) => post.uri);
  writeFeedCache(posts);
}

export function cacheNotifItems(notifs: any[], startAt = 1) {
  const posts: CachedPost[] = notifs
    .map((item: any, i: number) => ({
      index: startAt + i,
      uri: item.uri || "",
      cid: item.cid || "",
      author: item.author?.handle || "?",
      text: trunc((item.record?.text || "") + getEmbedAltText(item.embeds?.[0])),
      time: item.indexedAt || "",
      likes: 0,
      replies: 0,
      isRepost: false,
    }))
    .filter((post) => post.uri);
  writeFeedCache(posts);
}
