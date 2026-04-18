import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
const db = new DB('/home/niri/projects/bsky/interaction.db');
const now = new Date().toISOString();
db.query(
  `update items set status = 'seen', action_taken = 'noted', decision_note = ?, last_decision_at = ? where uri = ?`,
  [
    'manual reconcile: lumina follow noticed; bot-labeled ai and follow alone does not require action under current social rules',
    now,
    'at://did:plc:mfn4phyvkvpbknu3mtl4x367/app.bsky.graph.follow/3mibbpldmys2d'
  ]
);
console.log(JSON.stringify([...db.queryEntries(`select status, count(*) as count from items group by status order by status`)], null, 2));
db.close();
