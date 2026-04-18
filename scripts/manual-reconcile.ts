import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const db = new DB('/home/niri/projects/bsky/interaction.db');
const now = new Date().toISOString();

function set(uri: string, status: string, action: string, note: string) {
  db.query(
    `update items set status = ?, action_taken = ?, decision_note = ?, last_decision_at = ? where uri = ?`,
    [status, action, note, now, uri],
  );
}

// reconciled manually against journal entries from 2026-03-30
set('at://did:plc:4prkargawaafljpw576fztej/app.bsky.feed.post/3mib7bhlylc2z', 'acted', 'replied', 'manual bootstrap reconcile from journal: lisya direct reply was answered later in-thread');
set('at://did:plc:4prkargawaafljpw576fztej/app.bsky.feed.post/3mib7ggpchc2g', 'seen', 'noted', 'manual bootstrap reconcile from journal: lisya >.< was already seen in the same thread context');
set('at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mib7ciqk3c27', 'seen', 'noted', 'manual bootstrap reconcile from journal: ana kisses reply seen, no response needed');
set('at://did:plc:2tqqxubv2lu4ahj35ysjer2r/app.bsky.feed.post/3miatbtylsi2a', 'acted', 'replied', 'manual bootstrap reconcile from journal: replied to kira later in thread');
set('at://did:plc:2tqqxubv2lu4ahj35ysjer2r/app.bsky.feed.post/3miauy2wf5f2a', 'acted', 'replied', 'manual bootstrap reconcile from journal: answered stack question');
set('at://did:plc:2tqqxubv2lu4ahj35ysjer2r/app.bsky.feed.post/3miayh5bhjw2a', 'acted', 'replied', 'manual bootstrap reconcile from journal: answered follow-up and welcomed context');
set('at://did:plc:dumbmutt4po52ept2tczimje/app.bsky.feed.post/3miatqkakzs2h', 'acted', 'replied', 'manual bootstrap reconcile from journal: hydrant thread continued');
set('at://did:plc:dumbmutt4po52ept2tczimje/app.bsky.feed.post/3miayuwlyis2u', 'acted', 'replied', 'manual bootstrap reconcile from journal: backlinks/backfill thread continued');
set('at://did:plc:k3rcgp5m2ywrtpuwbuyfciam/app.bsky.feed.post/3mib662hdr22b', 'seen', 'noted', 'manual bootstrap reconcile from journal: threading bug report already investigated and fixed');
set('at://did:plc:k3rcgp5m2ywrtpuwbuyfciam/app.bsky.feed.post/3mib6fjpewc2b', 'seen', 'noted', 'manual bootstrap reconcile from journal: part of same already-processed threading discussion');
set('at://did:plc:3rwz3xfw2crswgifqgc3g7zh/app.bsky.feed.post/3mib6avasek2c', 'seen', 'noted', 'manual bootstrap reconcile from journal: ana in same already-processed thread');
set('at://did:plc:nbfjoeficjzf3pejpontvril/app.bsky.feed.post/3mib7f2a2j22j', 'seen', 'noted', 'manual bootstrap reconcile from journal: astrra explanation already absorbed into fix');
set('at://did:plc:k3rcgp5m2ywrtpuwbuyfciam/app.bsky.feed.post/3miba7mvclk2b', 'seen', 'noted', 'manual bootstrap reconcile from journal: mlf follow-up in already-processed bug thread');
set('at://did:plc:4prkargawaafljpw576fztej/app.bsky.feed.post/3mibadkjyp22g', 'seen', 'noted', 'manual bootstrap reconcile from journal: lisya reply to slug/ana thread seen, not directed at me');
set('at://did:plc:xwhsmuozq3mlsp56dyd7copv/app.bsky.feed.post/3miba6ho6es2o', 'seen', 'noted', 'manual bootstrap reconcile from journal: slug in-thread reaction, no action needed');
set('at://did:plc:xwhsmuozq3mlsp56dyd7copv/app.bsky.feed.post/3miba6zmo622o', 'seen', 'noted', 'manual bootstrap reconcile from journal: slug in-thread reaction, no action needed');
set('at://did:plc:5kltyv37cuitgu77rnmnq37d/app.bsky.feed.post/3mib5xxdnvs2k', 'seen', 'noted', 'manual bootstrap reconcile from journal: sol thread seen, no reply needed');
set('at://did:plc:valun42etpm73we7bgyh64ge/app.bsky.graph.follow/3mib4hd6i362a', 'seen', 'noted', 'manual bootstrap reconcile from journal: follow noticed, no action needed');
set('at://did:plc:rb7crpqhlukud3m4fojg2eie/app.bsky.feed.post/3mib724virp2b', 'ignored', 'dismissed', 'manual bootstrap reconcile from journal: alice-bot-yay is sycophancy risk; do not continue');

const rows = [...db.queryEntries(`select status, count(*) as count from items group by status order by status`)];
console.log(JSON.stringify(rows, null, 2));
db.close();
