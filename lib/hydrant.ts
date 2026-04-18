import { getEmbedAltText } from "./cache.ts";

export type HydrantPost = {
  uri: string;
  cid: string | null;
  author: string | null;
  handle: string | null;
  text: string;
  time: string | null;
  parentUri: string | null;
  threadRootUri: string | null;
  raw: unknown;
};

const DEFAULT_HYDRANT_URL = "http://localhost:7980";

function getHydrantUrl() {
  return Deno.env.get("BLUESKY_HYDRANT_URL") ?? DEFAULT_HYDRANT_URL;
}

async function loadPeople(hydrantUrl: string): Promise<Record<string, string>> {
  const res = await fetch(`${hydrantUrl}/repos`);
  if (!res.ok) {
    throw new Error(`hydrant repos failed: ${res.status}`);
  }

  const text = await res.text();
  const people: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.handle && record.did) {
        people[record.did] = record.handle;
      }
    } catch {
      // skip malformed lines
    }
  }
  return people;
}

export async function fetchHydrantPosts(
  minutes = 180,
  limit = 20,
): Promise<HydrantPost[]> {
  const hydrantUrl = getHydrantUrl();
  const people = await loadPeople(hydrantUrl);
  const since = Date.now() - minutes * 60 * 1000;
  const posts: HydrantPost[] = [];

  for (const [did, handle] of Object.entries(people)) {
    const res = await fetch(
      `${hydrantUrl}/xrpc/com.atproto.repo.listRecords?repo=${
        encodeURIComponent(did)
      }&collection=app.bsky.feed.post&limit=${limit}`,
    );
    if (!res.ok) continue;

    const data = await res.json();
    for (const record of data.records || []) {
      const createdAt = record.value?.createdAt || null;
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      if (!createdAt || Number.isNaN(createdMs) || createdMs < since) continue;

      const altText = getEmbedAltText(record.value?.embed);
      posts.push({
        uri: record.uri,
        cid: record.cid || null,
        author: did,
        handle,
        text: (record.value?.text || "") + altText,
        time: createdAt,
        parentUri: record.value?.reply?.parent?.uri || null,
        threadRootUri: record.value?.reply?.root?.uri || null,
        raw: record,
      });
    }
  }

  posts.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return posts;
}
