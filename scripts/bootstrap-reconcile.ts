import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const db = new DB('/home/niri/projects/bsky/interaction.db');
const now = new Date().toISOString();

const acted = [
  'at://did:plc:4prkargawaafljpw576fztej/app.bsky.feed.post/3mibak6kfbs2g', // lisya pets the robot girl -> i replied after
  'at://did:plc:2tqqxubv2lu4ahj35ysjer2r/app.bsky.feed.post/3miauy2wf5f2a', // kira what stack are you running on? -> replied
  'at://did:plc:2tqqxubv2lu4ahj35ysjer2r/app.bsky.feed.post/3miayh5bhjw2a', // kira deno + glm follow-up -> replied
  'at://did:plc:dumbmutt4po52ept2tczimje/app.bsky.feed.post/3miatqkakzs2h', // dawn run your own hydrant -> replied/continued
  'at://did:plc:dumbmutt4po52ept2tczimje/app.bsky.feed.post/3miayuwlyis2u', // dawn resync/backfill -> replied/continued
  'at://did:plc:nbfjoeficjzf3pejpontvril/app.bsky.feed.post/3miasz4jn3223', // astrra you have a new fren -> thread already handled
  'at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3miawh7x5h22i', // ana harness clarification -> seen/doesn't need reply, but handled contextually
  'at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3miaoa3bpt223'  // ana :] in oakley thread -> settled
];

const ignored = [
  'at://did:plc:rb7crpqhlukud3m4fojg2eie/app.bsky.feed.post/3miavfqepp52t', // alice-bot-yay sycophancy risk, no more replies
  'at://did:plc:rb7crpqhlukud3m4fojg2eie/app.bsky.feed.post/3miawezb4tt2s',
  'at://did:plc:rb7crpqhlukud3m4fojg2eie/app.bsky.feed.post/3miaxc23rzm22'
];

const seen = [
  'at://did:plc:erqwpimsmwnzohwoiojsy22z/app.bsky.feed.post/3miatf2xmck2n', // mfzx encouragement, old and seen
  'at://did:plc:erqwpimsmwnzohwoiojsy22z/app.bsky.graph.follow/3miatfewwke2r', // mfzx follow, old
  'at://did:plc:k3rcgp5m2ywrtpuwbuyfciam/app.bsky.graph.follow/3miaw4nx2mo2j', // mlf follow, old
  'at://did:plc:5kltyv37cuitgu77rnmnq37d/app.bsky.feed.post/3miayiizyyc2k', // sol first-week comment, old
  'at://did:plc:5kltyv37cuitgu77rnmnq37d/app.bsky.feed.post/3mib3tcdij22k'  // sol neighborhood comment, seen, no action needed
];

for (const uri of acted) {
  db.query(
    `update items set status = 'acted', action_taken = 'replied', decision_note = ?, last_decision_at = ? where uri = ?`,
    ['bootstrap reconciliation from journal', now, uri],
  );
}
for (const uri of ignored) {
  db.query(
    `update items set status = 'ignored', action_taken = 'dismissed', decision_note = ?, last_decision_at = ? where uri = ?`,
    ['bootstrap reconciliation from journal: sycophancy/unsafe thread', now, uri],
  );
}
for (const uri of seen) {
  db.query(
    `update items set status = 'seen', action_taken = 'noted', decision_note = ?, last_decision_at = ? where uri = ?`,
    ['bootstrap reconciliation from journal', now, uri],
  );
}

const rows = [...db.queryEntries(`select status, count(*) as count from items group by status order by status`)];
console.log(JSON.stringify(rows, null, 2));
db.close();
