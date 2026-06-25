/**
 * Typed client for sister-radio xrpc endpoints.
 *
 * Lexicon source: https://tangled.org/okami.mom/sister-radio (lexicons/)
 * Endpoints documented in docs/xrpc.md
 * Proxy: did:web:radio.nekomimi.pet#radio_xrpc via PDS at sharkgirl.pet
 *
 * Type safety: custom radio lexicons aren't in @atcute/lexicons ambient,
 * so the Client is unbounded (any). All public APIs are strictly typed
 * against the official lexicon schemas.
 */

import { Client, ok, type FetchHandler } from "npm:@atcute/client@4.2.1";
import { simpleFetchHandler } from "npm:@atcute/client@4.2.1";
import { pdsUrl } from "./config.ts";
import { getAuthedClient } from "./auth.ts";

// ── types from pet.nkp.radio lexicon ────────────────────────────────────

export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  durationSeconds: number | null;
  mimeType: string | null;
  hasCover: boolean;
  addedByDid: string;
  createdAt: number;
  loudnessLufs: string | null;
  loudnessPeak: string | null;
}

export interface QueueItem {
  id: string;
  position: number;
  queuedByDid: string;
  songId: string;
  title: string;
  artist: string;
  album: string | null;
  addedByDid: string;
}

export interface RadioState {
  currentSongId: string | null;
  status: "playing" | "paused" | "stopped";
  startedAt: number | null;
  pausedAt: number | null;
  positionSeconds: number;
  updatedByDid: string | null;
}

export interface RadioSnapshot {
  state: RadioState;
  currentSong: Song | null;
  queue: QueueItem[];
}

export interface SongUrlSource {
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  addToQueue?: boolean;
}

// ── queue.modify input (discriminated union by action) ───────────────────

export type QueueAction = "enqueue" | "remove" | "clear" | "reorder";

export interface EnqueueInput {
  action: "enqueue";
  songIds: string[];
}

export interface RemoveInput {
  action: "remove";
  queueId: string;
}

export interface ClearInput {
  action: "clear";
}

export interface ReorderInput {
  action: "reorder";
  queueIds: string[];
}

export type QueueModifyInput = EnqueueInput | RemoveInput | ClearInput | ReorderInput;

// ── unbounded client (custom lexicons not in registry) ──────────────────

const RADIO_DID = "did:web:radio.nekomimi.pet";
const RADIO_SERVICE_ID = "#radio_xrpc";

let _client: Client<any, any> | null = null;

async function getRadioClient(): Promise<Client<any, any>> {
  if (_client) return _client;

  const authed = await getAuthedClient();
  const baseHandler = simpleFetchHandler({ service: pdsUrl });

  const handler: FetchHandler = (pathname, init) => {
    const headers = new Headers((init as any).headers ?? {});
    headers.set("Authorization", `Bearer ${authed.token}`);
    return baseHandler(pathname, { ...init, headers });
  };

  _client = new Client({
    handler,
    proxy: { did: RADIO_DID, serviceId: RADIO_SERVICE_ID },
  });

  return _client;
}

// ── queries ──────────────────────────────────────────────────────────────

/** Load the current radio snapshot (playback state + upcoming queue). */
export async function getQueue(): Promise<RadioSnapshot> {
  const radio = await getRadioClient();
  const res = await radio.get("pet.nkp.radio.queue.list", {});
  return (res.data as unknown as { snapshot: RadioSnapshot }).snapshot;
}

/** List all songs in the library, newest first. */
export async function listSongs(): Promise<Song[]> {
  const radio = await getRadioClient();
  const res = await radio.get("pet.nkp.radio.songs.list", {});
  return (res.data as unknown as { songs: Song[] }).songs;
}

// ── procedures ───────────────────────────────────────────────────────────

/** Modify the queue. Returns updated snapshot. */
export async function modifyQueue(input: QueueModifyInput): Promise<RadioSnapshot> {
  const radio = await getRadioClient();
  const res = await ok(radio.post("pet.nkp.radio.queue.modify", { input }));
  return (res as unknown as { snapshot: RadioSnapshot }).snapshot;
}

/** Enqueue one or more songs by ID. */
export async function enqueue(songIds: string[]): Promise<RadioSnapshot> {
  return modifyQueue({ action: "enqueue", songIds });
}

/** Remove a queue item by its stable ID. */
export async function removeFromQueue(queueId: string): Promise<RadioSnapshot> {
  return modifyQueue({ action: "remove", queueId });
}

/** Clear the entire queue. */
export async function clearQueue(): Promise<RadioSnapshot> {
  return modifyQueue({ action: "clear" });
}

/** Reorder queue by providing item IDs in desired order. */
export async function reorderQueue(queueIds: string[]): Promise<RadioSnapshot> {
  return modifyQueue({ action: "reorder", queueIds });
}

// ── song import ──────────────────────────────────────────────────────────

/** Import remote audio sources. Returns imported/deduplicated songs + updated snapshot. */
export async function addSongs(sources: SongUrlSource[]): Promise<{
  songs: Song[];
  snapshot: RadioSnapshot;
}> {
  const radio = await getRadioClient();
  const res = await ok(radio.post("pet.nkp.radio.songs.add", { input: { sources } }));
  const unwrapped = res as unknown as { songs: unknown[]; snapshot: unknown };
  return {
    songs: unwrapped.songs as Song[],
    snapshot: unwrapped.snapshot as RadioSnapshot,
  };
}

// ── file upload ──────────────────────────────────────────────────────────

export interface UploadInput {
  filePath: string;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  durationSeconds?: number;
  addToQueue?: boolean;
}

/** Upload a local audio file via multipart form-data. Uses service JWT auth. */
export async function uploadSong(input: UploadInput): Promise<{
  songs: Song[];
  snapshot: RadioSnapshot;
}> {
  // need raw fetch for multipart — atcute client doesn't support it
  const authed = await getAuthedClient();

  // get a service JWT scoped to the upload endpoint
  const svcRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.getServiceAuth?` +
      new URLSearchParams({
        aud: `${RADIO_DID}${RADIO_SERVICE_ID}`,
        lxm: "pet.nkp.radio.songs.upload",
      }),
    { headers: { Authorization: `Bearer ${authed.token}` } },
  );
  if (!svcRes.ok) throw new Error(`serviceAuth failed: ${await svcRes.text()}`);
  const { token } = await svcRes.json();

  // build multipart body
  const file = await Deno.readFile(input.filePath);
  const boundary = `----UploadBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const fileName = input.filePath.split("/").pop() || "audio.bin";

  let body = "";
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`;
  body += `Content-Type: audio/mpeg\r\n\r\n`;

  const header = new TextEncoder().encode(body);
  const footer = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);

  // optional metadata fields
  const metaFields: [string, string][] = [
    ["title", input.title],
    ["artist", input.artist],
    ["album", input.album],
    ["genre", input.genre],
    ["durationSeconds", input.durationSeconds?.toString()],
    ["addToQueue", input.addToQueue?.toString()],
  ].filter(([, v]) => v !== undefined);

  const metaParts = metaFields
    .map(([k, v]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    )
    .join("");

  const combined = [
    header,
    new TextEncoder().encode(metaParts),
    file,
    footer,
  ];

  const totalLength = combined.reduce((sum, part) => sum + part.byteLength, 0);
  const blob = new Blob(combined, { type: `multipart/form-data; boundary=${boundary}` });

  const uploadUrl = `https://radio.wisp.place/xrpc/pet.nkp.radio.songs.upload`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: blob,
  });

  if (!res.ok) throw new Error(`upload failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  return {
    songs: data.songs as Song[],
    snapshot: data.snapshot as RadioSnapshot,
  };
}
