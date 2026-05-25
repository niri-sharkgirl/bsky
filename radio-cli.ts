#!/usr/bin/env deno run -A
// Sister Radio CLI — queue songs, check the queue, browse the library
// Usage: deno run -A radio-cli.ts <command> [args]

import { getQueue, listSongs, enqueue, addSongs, removeFromQueue, clearQueue } from "./lib/radio.ts";

const commands = {
  async now() {
    const q = await getQueue();
    if (q.nowPlaying) {
      console.log("🎵 Now playing:", q.nowPlaying.title, "—", q.nowPlaying.artist);
      console.log("   Album:", q.nowPlaying.album, "|", formatTime(q.nowPlaying.durationSeconds));
      const pos = q.state?.positionSeconds || 0;
      console.log("   Position:", formatTime(pos), "/", formatTime(q.nowPlaying.durationSeconds));
    } else {
      console.log("Nothing playing");
    }
  },

  async queue() {
    const q = await getQueue();
    console.log("📋 Queue (" + (q.queue?.length || 0) + " items):");
    if (!q.queue?.length) { console.log("  (empty)"); return; }
    for (const item of q.queue) {
      console.log("  " + item.position + ".", item.song?.title || "(processing)", "—", item.song?.artist || "", "[" + formatTime(item.song?.durationSeconds) + "]");
    }
  },

  async search(query: string) {
    const songs = await listSongs();
    const q = query.toLowerCase();
    const results = songs.filter(s => 
      s.title?.toLowerCase().includes(q) || 
      s.artist?.toLowerCase().includes(q) ||
      s.album?.toLowerCase().includes(q)
    );
    console.log("🔍 Found", results.length, 'songs matching "' + query + '":');
    for (const s of results.slice(0, 20)) {
      console.log("  " + s.id.slice(0,8), "|", s.title, "—", s.artist, "(" + s.album + ") [" + formatTime(s.durationSeconds) + "]");
    }
    if (results.length > 20) console.log("  ... and", results.length - 20, "more");
  },

  async enqueue(...ids: string[]) {
    console.log("🎶 Enqueuing", ids.length, "song(s)...");
    const result = await enqueue(ids);
    console.log("✓ Queue now has", result.queue?.length, "items");
    const last = result.queue?.[result.queue.length - 1];
    if (last?.song) {
      console.log("  Last added:", last.song.title, "at position", last.position);
    }
  },

  async add(...urls: string[]) {
    // parse urls and optional metadata
    const sources = urls.map(u => {
      if (u.startsWith("http")) return { url: u, addToQueue: true };
      // treat as song ID from library
      return null;
    }).filter(Boolean) as { url: string; addToQueue: boolean }[];
    
    if (!sources.length) {
      console.log("Usage: radio-cli.ts add <youtube_url> [<youtube_url2> ...]");
      return;
    }
    
    console.log("➕ Adding", sources.length, "song(s) from YouTube...");
    const result = await addSongs(sources);
    console.log("Returned", result.songs.length, "songs (async processing)");
    console.log("Queue:", result.snapshot.queue?.length, "items");
  },

  async remove(queueId: string) {
    console.log("🗑️ Removing queue item", queueId, "...");
    const result = await removeFromQueue(queueId);
    console.log("✓ Queue now has", result.queue?.length, "items");
  },

  async clear() {
    console.log("🗑️ Clearing queue...");
    const result = await clearQueue();
    console.log("✓ Cleared. Queue:", result.queue?.length, "items");
  },
};

function formatTime(secs?: number): string {
  if (!secs) return "??:??";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m.toString().padStart(2,"0") + ":" + s.toString().padStart(2,"0");
}

// main
const args = Deno.args;
const cmd = args[0];

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(`
Sister Radio CLI 📻

Commands:
  now          Show what's currently playing
  queue        Show the current queue
  search <q>   Search library by title/artist/album  
  enqueue <id> Add song(s) to queue by ID (from search)
  add <url>    Add song(s) from YouTube URL
  remove <id>  Remove item from queue
  clear        Clear the entire queue
  help         Show this message

Examples:
  radio-cli.ts now
  radio-cli.ts queue
  radio-cli.ts search garoad
  radio-cli.ts enqueue d1d297f9-af3e-4b33-a410-a2cac6dbc8ae
  radio-cli.ts add https://www.youtube.com/watch?v=WLLogeHex_Y
`);
  Deno.exit(0);
}

if (!(cmd in commands)) {
  console.error("Unknown command:", cmd);
  console.log("Run 'radio-cli.ts help' for available commands");
  Deno.exit(1);
}

try {
  const fn = (commands as Record<string, (...a: any[]) => Promise<void>>)[cmd];
  if (typeof fn !== "function") throw new Error("Not a command: " + cmd);
  await fn(...args.slice(1));
} catch(e) {
  console.error("Error:", e.message || e);
  Deno.exit(1);
}
