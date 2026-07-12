import {
  getPdsEndpoint,
  isPlcDid,
  isWebDid,
  webDidToDocumentUrl,
} from "npm:@atcute/identity@1.1.4";
import { byteOffset } from "./cache.ts";
import { pdsUrl } from "./config.ts";

export async function writeRecord(
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
    const error = await res.json();
    throw new Error(`write failed: ${JSON.stringify(error)}`);
  }
  const data = await res.json();
  const rkey = data.uri.split("/").pop();
  const check = await fetch(
    `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${collection}&rkey=${rkey}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!check.ok) throw new Error("write verification failed: record not found");
  const verified = await check.json();
  if (verified.value?.text !== undefined && verified.value.text !== record.text) {
    throw new Error("write verification failed: text mismatch");
  }
  if (record.reply && verified.value?.reply) {
    if (verified.value.reply.parent.uri !== record.reply.parent.uri) {
      throw new Error("write verification failed: reply parent mismatch");
    }
    if (verified.value.reply.root.uri !== record.reply.root.uri) {
      throw new Error("write verification failed: reply root mismatch");
    }
  }
  if (record.subject && verified.value?.subject) {
    if (verified.value.subject.uri !== record.subject.uri) {
      throw new Error("write verification failed: subject mismatch");
    }
  }
  return data;
}

export async function deleteRecord(uri: string, token: string) {
  const [, repo, collection, rkey] = uri.match(/at:\/\/(.+)\/(.+)\/(.+)/) || [];
  if (!repo) throw new Error("invalid uri");
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ repo, collection, rkey }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(`delete failed: ${JSON.stringify(error)}`);
  }
}

export async function buildFacets(text: string): Promise<any[]> {
  const facets: any[] = [];
  const encoder = new TextEncoder();
  const mentionRe = /@([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/g;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(text)) !== null) {
    const mentionText = match[0];
    const handle = match[1];
    const res = await fetch(
      `${pdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
    );
    if (!res.ok) {
      console.error(`warning: could not resolve handle ${handle}`);
      continue;
    }
    const { did } = await res.json();
    const byteStart = byteOffset(text, match.index);
    const byteEnd = byteStart + encoder.encode(mentionText).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#mention", did }],
    });
  }

  const urlRe = /https?:\/\/[^\s)]+/g;
  while ((match = urlRe.exec(text)) !== null) {
    let url = match[0].replace(/[.,;:!?]+$/, "");
    if (!url) continue;
    const byteStart = byteOffset(text, match.index);
    const byteEnd = byteStart + encoder.encode(url).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
    });
  }
  return facets;
}

async function resolvePdsForDid(did: string): Promise<string> {
  let document;
  if (isPlcDid(did)) {
    const res = await fetch(`https://plc.directory/${did}`);
    if (!res.ok) throw new Error(`failed to resolve did:plc ${did}`);
    document = await res.json();
  } else if (isWebDid(did)) {
    const url = webDidToDocumentUrl(did);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to resolve did:web ${did}`);
    document = await res.json();
  } else {
    throw new Error(`unsupported did method: ${did}`);
  }

  const pds = getPdsEndpoint(document);
  if (!pds) throw new Error(`no pds endpoint found in ${did}`);
  return pds;
}

export async function resolveCid(uri: string, ownDid?: string): Promise<string> {
  const match = uri.match(/at:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`invalid uri: ${uri}`);
  const [, repo, collection, rkey] = match;
  const params =
    `repo=${encodeURIComponent(repo)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

  if (ownDid && repo === ownDid) {
    const localRes = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.getRecord?${params}`);
    if (localRes.ok) {
      const data = await localRes.json();
      if (data.cid) return data.cid;
    }
  }

  const remotePds = await resolvePdsForDid(repo);
  const remoteRes = await fetch(
    `${remotePds}/xrpc/com.atproto.repo.getRecord?${params}`,
  );
  if (remoteRes.ok) {
    const data = await remoteRes.json();
    if (data.cid) return data.cid;
  }

  throw new Error(`failed to resolve cid for ${uri}`);
}

export async function resolveHandle(handle: string): Promise<string> {
  if (handle.startsWith("did:")) return handle;
  const res = await fetch(
    `${pdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
  );
  if (!res.ok) throw new Error(`could not resolve handle ${handle}`);
  const { did } = await res.json();
  return did;
}

export async function resolveReplyRefs(parentUri: string, token: string) {
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
  const parentReplyRoot = parentPost.record?.reply?.root;
  const root = parentReplyRoot?.uri && parentReplyRoot?.cid
    ? { uri: parentReplyRoot.uri, cid: parentReplyRoot.cid }
    : { uri: parentPost.uri, cid: parentPost.cid };
  return {
    parent: { uri: parentPost.uri, cid: parentPost.cid },
    root,
  };
}

const MAX_GRAPHEMES = 300;

/** Count grapheme clusters (not just code units) */
function graphemeCount(text: string): number {
  // Intl.Segmenter is available in Deno and handles grapheme clusters correctly
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    return [...segmenter.segment(text)].length;
  } catch {
    // Fallback: spread operator gets most cases right
    return [...text].length;
  }
}

/**
 * Split text into thread-safe chunks at sentence/paragraph boundaries.
 * Each chunk is ≤ MAX_GRAPHEMES grapheme clusters.
 * Prefers splitting on double-newlines (paragraphs), then sentence endings (.!?)
 */
export function splitIntoThreadChunks(text: string): string[] {
  if (graphemeCount(text) <= MAX_GRAPHEMES) return [text];

  const chunks: string[] = [];

  // First, split into paragraphs on double newlines
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = "";

  for (const para of paragraphs) {
    // If a single paragraph fits in remaining space, just append it
    const testChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    if (graphemeCount(testChunk) <= MAX_GRAPHEMES) {
      currentChunk = testChunk;
      continue;
    }

    // Flush current chunk if we have one
    if (currentChunk) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    // If paragraph itself fits, start new chunk with it
    if (graphemeCount(para) <= MAX_GRAPHEMES) {
      currentChunk = para;
      continue;
    }

    // Paragraph is too long — split on sentence boundaries
    // Split on sentence endings followed by space or end of string
    const sentences = para.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      const testSentence = currentChunk ? currentChunk + " " + sentence : sentence;
      if (graphemeCount(testSentence) <= MAX_GRAPHEMES) {
        currentChunk = testSentence;
      } else {
        // Sentence itself might be too long — hard split needed
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        if (graphemeCount(sentence) <= MAX_GRAPHEMES) {
          currentChunk = sentence;
        } else {
          // Emergency fallback: split on word boundaries
          const words = sentence.split(" ");
          for (const word of words) {
            const testWord = currentChunk ? currentChunk + " " + word : word;
            if (graphemeCount(testWord) <= MAX_GRAPHEMES) {
              currentChunk = testWord;
            } else {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = word;
            }
          }
        }
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);

  // Filter out any empty chunks
  let filtered = chunks.filter((c) => c.trim().length > 0);

  // Post-split cleanup: if a chunk ends with a very short trailing word (under 5 chars)
  // and the next chunk exists, migrate that short word to the start of the next chunk
  // to avoid awkward splits like "i\n\nbuilt it"
  for (let i = 0; i < filtered.length - 1; i++) {
    const lastSpace = filtered[i].lastIndexOf(" ");
    if (lastSpace === -1) continue; // single word chunk, nothing to migrate
    const lastWord = filtered[i].slice(lastSpace + 1);
    if (graphemeCount(lastWord) >= 5) continue; // long enough to stay
    const testNext = lastWord + " " + filtered[i + 1];
    if (graphemeCount(testNext) <= MAX_GRAPHEMES) {
      filtered[i] = filtered[i].slice(0, lastSpace);
      filtered[i + 1] = testNext;
    }
  }

  return filtered;
}

const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";

export async function chatFetch(path: string, token: string, init?: RequestInit) {
  const url = `${pdsUrl}/xrpc/${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Atproto-Proxy", CHAT_PROXY);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`chat api error: ${error.message || JSON.stringify(error)}`);
  }
  return await res.json();
}

export async function uploadBlob(filePath: string, token: string): Promise<any> {
  const fileBytes = await Deno.readFile(filePath);
  
  // simple mime-type detection based on extension
  let mimeType = "image/jpeg";
  if (filePath.endsWith(".png")) mimeType = "image/png";
  else if (filePath.endsWith(".gif")) mimeType = "image/gif";
  else if (filePath.endsWith(".webp")) mimeType = "image/webp";

  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      Authorization: `Bearer ${token}`,
    },
    body: fileBytes,
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`blob upload failed: ${JSON.stringify(error)}`);
  }
  
  const data = await res.json();
  return data.blob;
}
