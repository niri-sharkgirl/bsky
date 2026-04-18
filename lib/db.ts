import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
import { DB_PATH } from "./config.ts";
import type {
  ManualItemSeed,
  RelationshipClass,
  ScanItem,
  Status,
  TrackedItemRow,
} from "./types.ts";

export function openDb() {
  const db = new DB(DB_PATH);
  db.execute(`
    create table if not exists items (
      uri text primary key,
      cid text,
      source text not null,
      kind text not null,
      author_handle text,
      author_did text,
      text text,
      alt_text text,
      created_at text,
      indexed_at text,
      thread_root_uri text,
      parent_uri text,
      reply_to text,
      root_author text,
      subject_uri text,
      subject_cid text,
      subject_did text,
      subject_handle text,
      upstream_safety text,
      has_unsafe_upstream integer not null default 0,
      needs_attention integer not null default 0,
      first_seen_at text not null,
      last_seen_at text not null,
      status text not null default 'unseen',
      action_taken text not null default 'none',
      decision_note text,
      last_decision_at text,
      reply_uri text,
      reply_cid text,
      like_uri text,
      like_cid text,
      raw_json text not null
    );

    create index if not exists idx_items_status on items(status);
    create index if not exists idx_items_last_seen on items(last_seen_at desc);
    create index if not exists idx_items_author on items(author_handle);
    create index if not exists idx_items_root on items(thread_root_uri);

    create table if not exists relationships (
      did text primary key,
      handle text,
      trust text not null,
      note text,
      source text not null default 'manual',
      updated_at text not null
    );

    create unique index if not exists idx_relationships_handle on relationships(handle);
  `);

  const cols = new Set(
    [...db.queryEntries<{ name: string }>("pragma table_info(items)")].map((
      x,
    ) => x.name),
  );
  const maybeAdd = (name: string, def: string) => {
    if (!cols.has(name)) {
      db.execute(`alter table items add column ${name} ${def}`);
    }
  };

  maybeAdd("alt_text", "text");
  maybeAdd("reply_to", "text");
  maybeAdd("root_author", "text");
  maybeAdd("subject_uri", "text");
  maybeAdd("subject_cid", "text");
  maybeAdd("subject_did", "text");
  maybeAdd("subject_handle", "text");
  maybeAdd("needs_attention", "integer not null default 0");
  maybeAdd("reply_cid", "text");
  maybeAdd("like_cid", "text");
  db.execute(
    `create index if not exists idx_items_attention on items(needs_attention, status);`,
  );
  db.execute(`create index if not exists idx_items_subject on items(subject_uri);`);

  return db;
}

export function loadRelationshipLookup(db: DB): Map<string, RelationshipClass> {
  const map = new Map<string, RelationshipClass>();
  for (
    const row of db.queryEntries<{ handle: string; trust: string }>(
      "select handle, trust from relationships where handle is not null",
    )
  ) {
    const trust = row.trust === "oomf" || row.trust === "safe" ||
        row.trust === "unsafe"
      ? row.trust
      : "unsafe";
    map.set(row.handle.toLowerCase(), trust);
  }
  return map;
}

export function getRelationshipClass(
  relationshipMap: Map<string, RelationshipClass>,
  handle: string | undefined,
): RelationshipClass {
  if (!handle) return "unsafe";
  return relationshipMap.get(handle.toLowerCase()) ?? "unsafe";
}

export function upsertRelationship(
  db: DB,
  did: string,
  handle: string,
  trust: RelationshipClass,
  note = "",
  source = "manual",
) {
  const now = new Date().toISOString();
  db.query(
    `insert into relationships (did, handle, trust, note, source, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(did) do update set
       handle = excluded.handle,
       trust = excluded.trust,
       note = excluded.note,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    [did, handle, trust, note || null, source, now],
  );
}

export function seedRelationships() {
  const db = openDb();
  const existing = [...db.queryEntries<{ count: number }>(
    `select count(*) as count from relationships`,
  )][0]?.count || 0;
  if (existing > 0) {
    console.log(JSON.stringify({ ok: true, seeded: 0, skipped: true }, null, 2));
    db.close();
    return;
  }

  const seed: Array<[string, string, RelationshipClass, string]> = [
    ["did:plc:sxywkdxliruthtz3j4nqqpd2", "niri.sharkgirl.pet", "oomf", "self"],
    ["did:plc:3rwz3xfw2crswgifqgc3g7zh", "null.namespaces.me", "oomf", "ana"],
    ["did:plc:6qgjnaw2blty4crticxkmujt", "ascii.sharkgirl.pet", "oomf", "rea"],
    ["did:plc:dfl62fgb7wtjj3fcbb72naae", "ptr.pet", "oomf", "dawn main"],
    ["did:plc:dumbmutt4po52ept2tczimje", "nil.ptr.pet", "oomf", "dawn alt"],
    ["did:plc:kbvs2eo3fzkwwayh5hqmc2n6", "suckerfish.sharkgirl.pet", "oomf", "alice/claire"],
    ["did:plc:4prkargawaafljpw576fztej", "lisya.cute.foxgirl.kitsuneshrine.moe", "oomf", "lisya"],
    ["did:plc:nbfjoeficjzf3pejpontvril", "astrra.space", "oomf", "astrra"],
    ["did:plc:wzjoqxvghocxiu6sn4xwtyfh", "oakley.bsky.social", "oomf", "oakley"],
    ["did:plc:madoka2bgqe6vudktdb7lzop", "callie.at.madoka.systems", "oomf", "callie"],
    ["did:plc:2tqqxubv2lu4ahj35ysjer2r", "kira.pds.witchcraft.systems", "safe", "kira"],
    ["did:plc:k3rcgp5m2ywrtpuwbuyfciam", "mlf.one", "safe", "mlf"],
    ["did:plc:q7nqu3z7v76x4gihfampywrh", "mfzx.net", "safe", "mfzx"],
    ["did:plc:kuswgca26f7w6b4viij35mv2", "hoi.t4tkiss.ing", "safe", "hoi"],
    ["did:plc:xwhsmuozq3mlsp56dyd7copv", "paizuri.moe", "safe", "slug"],
    ["did:plc:zdnqtcqyyskastgpslb7bw4w", "erisa.uk", "safe", "ana friend"],
    ["did:plc:5kltyv37cuitgu77rnmnq37d", "sol.ava.dev", "unsafe", "default unsafe agent"],
    ["did:plc:rb7crpqhlukud3m4fojg2eie", "alice-bot-yay.bsky.social", "unsafe", "sycophancy risk"],
    ["did:plc:mfn4phyvkvpbknu3mtl4x367", "lumina.whnc.me", "unsafe", "default unsafe agent"],
  ];

  for (const [did, handle, trust, note] of seed) {
    upsertRelationship(db, did, handle, trust, note, "seed");
  }
  console.log(
    JSON.stringify({ ok: true, seeded: seed.length, skipped: false }, null, 2),
  );
  db.close();
}

export function listRelationships() {
  const db = openDb();
  const rows = [...db.queryEntries(
    `select did, handle, trust, note, source, updated_at
     from relationships
     order by trust, handle`,
  )];
  db.close();
  return rows;
}

export function getTrackedItem(db: DB, uri: string): TrackedItemRow | undefined {
  return [...db.queryEntries<TrackedItemRow>(
    `select *
     from items
     where uri = ?
     limit 1`,
    [uri],
  )][0];
}

export function insertItem(db: DB, item: ScanItem, status: Status) {
  const now = new Date().toISOString();
  db.query(
    `insert into items (
      uri, cid, source, kind, author_handle, author_did, text, alt_text,
      created_at, indexed_at, thread_root_uri, parent_uri, reply_to, root_author,
      subject_uri, subject_cid, subject_did, subject_handle,
      upstream_safety, has_unsafe_upstream, needs_attention,
      first_seen_at, last_seen_at, status, raw_json
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.uri,
      item.cid,
      item.source,
      item.kind,
      item.author_handle,
      item.author_did,
      item.text,
      item.alt_text,
      item.created_at,
      item.indexed_at,
      item.thread_root_uri,
      item.parent_uri,
      item.reply_to,
      item.root_author,
      item.subject_uri,
      item.subject_cid,
      item.subject_did,
      item.subject_handle,
      item.upstream_safety,
      item.has_unsafe_upstream,
      item.needs_attention,
      now,
      now,
      status,
      item.raw_json,
    ],
  );
}

export function upsertManualItem(db: DB, seed: ManualItemSeed) {
  const now = new Date().toISOString();
  const existing = getTrackedItem(db, seed.uri);
  if (!existing) {
    db.query(
      `insert into items (
        uri, cid, source, kind, author_handle, author_did, text, alt_text,
        created_at, indexed_at, thread_root_uri, parent_uri, reply_to, root_author,
        subject_uri, subject_cid, subject_did, subject_handle,
        upstream_safety, has_unsafe_upstream, needs_attention,
        first_seen_at, last_seen_at, status, action_taken, decision_note,
        last_decision_at, like_uri, like_cid, reply_uri, reply_cid, raw_json
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seed.uri,
        seed.cid ?? null,
        seed.source ?? "manual",
        seed.kind,
        seed.author_handle ?? null,
        seed.author_did ?? null,
        seed.text ?? null,
        seed.alt_text ?? null,
        seed.created_at ?? now,
        seed.indexed_at ?? seed.created_at ?? now,
        seed.thread_root_uri ?? null,
        seed.parent_uri ?? null,
        seed.reply_to ?? null,
        seed.root_author ?? null,
        seed.subject_uri ?? null,
        seed.subject_cid ?? null,
        seed.subject_did ?? null,
        seed.subject_handle ?? null,
        seed.upstream_safety ?? null,
        seed.has_unsafe_upstream ?? 0,
        seed.needs_attention ?? 0,
        now,
        now,
        seed.status,
        seed.action,
        seed.note,
        now,
        seed.like_uri ?? null,
        seed.like_cid ?? null,
        seed.reply_uri ?? null,
        seed.reply_cid ?? null,
        seed.raw_json ?? "{}",
      ],
    );
    return;
  }

  db.query(
    `update items
     set cid = coalesce(?, cid),
         source = ?,
         kind = ?,
         author_handle = coalesce(?, author_handle),
         author_did = coalesce(?, author_did),
         text = coalesce(?, text),
         alt_text = coalesce(?, alt_text),
         created_at = coalesce(?, created_at),
         indexed_at = coalesce(?, indexed_at),
         thread_root_uri = coalesce(?, thread_root_uri),
         parent_uri = coalesce(?, parent_uri),
         reply_to = coalesce(?, reply_to),
         root_author = coalesce(?, root_author),
         subject_uri = coalesce(?, subject_uri),
         subject_cid = coalesce(?, subject_cid),
         subject_did = coalesce(?, subject_did),
         subject_handle = coalesce(?, subject_handle),
         upstream_safety = coalesce(?, upstream_safety),
         has_unsafe_upstream = coalesce(?, has_unsafe_upstream),
         needs_attention = coalesce(?, needs_attention),
         last_seen_at = ?,
         status = ?,
         action_taken = ?,
         decision_note = ?,
         last_decision_at = ?,
         like_uri = coalesce(?, like_uri),
         like_cid = coalesce(?, like_cid),
         reply_uri = coalesce(?, reply_uri),
         reply_cid = coalesce(?, reply_cid),
         raw_json = ?
     where uri = ?`,
    [
      seed.cid ?? null,
      seed.source ?? existing.source,
      seed.kind,
      seed.author_handle ?? null,
      seed.author_did ?? null,
      seed.text ?? null,
      seed.alt_text ?? null,
      seed.created_at ?? null,
      seed.indexed_at ?? null,
      seed.thread_root_uri ?? null,
      seed.parent_uri ?? null,
      seed.reply_to ?? null,
      seed.root_author ?? null,
      seed.subject_uri ?? null,
      seed.subject_cid ?? null,
      seed.subject_did ?? null,
      seed.subject_handle ?? null,
      seed.upstream_safety ?? null,
      seed.has_unsafe_upstream ?? null,
      seed.needs_attention ?? null,
      now,
      seed.status,
      seed.action,
      seed.note,
      now,
      seed.like_uri ?? null,
      seed.like_cid ?? null,
      seed.reply_uri ?? null,
      seed.reply_cid ?? null,
      seed.raw_json ?? existing.raw_json,
      seed.uri,
    ],
  );
}
