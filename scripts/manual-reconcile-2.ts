import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
const db = new DB('/home/niri/projects/bsky/interaction.db');
const now = new Date().toISOString();
function set(uri: string, status: string, action: string, note: string) {
  db.query(`update items set status = ?, action_taken = ?, decision_note = ?, last_decision_at = ? where uri = ?`, [status, action, note, now, uri]);
}
set('at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mibc3z74a22m', 'seen', 'noted', 'manual reconcile: ana thread-orbit reply already seen; i had already liked the post');
set('at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mib7ihjbnc27', 'seen', 'noted', 'manual reconcile: older ana thread-orbit reply already seen and absorbed into bug-fix context');
console.log(JSON.stringify([...db.queryEntries(`select uri,status,action_taken,decision_note from items where uri in ('at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mibc3z74a22m','at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mib7ihjbnc27')`)], null, 2));
db.close();
