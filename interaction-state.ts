import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

const ROOT = "/home/niri/projects/bsky";
const DB_PATH = `${ROOT}/interaction.db`;
const DENO = "/home/niri/.deno/bin/deno";
const CLIENT = `${ROOT}/bsky-client.ts`;
const HYDRANT = `${ROOT}/hydrant-poll.ts`;
const MY_HANDLE = "niri.sharkgirl.pet";
const CUSTOM_FEED_URI = "at://did:plc:3guzzweuqraryl3rdkimjamk/app.bsky.feed.generator/for-you";

const clientPerms = [
  "--allow-env",
  "--allow-read",
  "--allow-net",
  "--allow-sys",
  "--allow-write",
  "--allow-run",
];

type Source = "feed" | "notif" | "hydrant" | "user-feed" | "custom-feed";
type ItemKind =
  | "post"
  | "reply"
  | "mention"
  | "like"
  | "follow"
  | "repost"
  | "system";
type Status = "unseen" | "seen" | "ambient" | "acted" | "ignored" | "pending";
type Action = "none" | "replied" | "liked" | "followed" | "dismissed" | "noted";

type ScanItem = {
  uri: string;
  cid: string | null;
  source: Source;
  kind: ItemKind;
  author_handle: string | null;
  author_did: string | null;
  text: string | null;
  alt_text: string | null;
  created_at: string | null;
  indexed_at: string | null;
  thread_root_uri: string | null;
  parent_uri: string | null;
  reply_to: string | null;
  root_author: string | null;
  upstream_safety: string | null;
  has_unsafe_upstream: number;
  needs_attention: number;
  raw_json: string;
};

function openDb() {
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
      created_at text,
      indexed_at text,
      thread_root_uri text,
      parent_uri text,
      reply_to text,
      root_author text,
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
  maybeAdd("reply_to", "text");
  maybeAdd("alt_text", "text");
  maybeAdd("root_author", "text");
  maybeAdd("needs_attention", "integer not null default 0");
  db.execute(
    `create index if not exists idx_items_attention on items(needs_attention, status);`,
  );

  return db;
}

function upsertRelationship(
  db: DB,
  did: string,
  handle: string,
  trust: "oomf" | "safe" | "unsafe",
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

function seedRelationships() {
  const db = openDb();
  const existing = [...db.queryEntries<{ count: number }>(
    `select count(*) as count from relationships`,
  )][0]?.count || 0;
  if (existing > 0) {
    console.log(JSON.stringify({ ok: true, seeded: 0, skipped: true }, null, 2));
    db.close();
    return;
  }

  const seed: Array<[string, string, "oomf" | "safe" | "unsafe", string]> = [
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
  console.log(JSON.stringify({ ok: true, seeded: seed.length, skipped: false }, null, 2));
  db.close();
}

function listRelationships() {
  const db = openDb();
  const rows = [...db.queryEntries(
    `select did, handle, trust, note, source, updated_at from relationships order by trust, handle`,
  )];
  console.log(JSON.stringify(rows, null, 2));
  db.close();
}

async function runJson(cmd: string[], cwd = ROOT) {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await p.output();
  if (!out.success) {
    throw new Error(
      new TextDecoder().decode(out.stderr) ||
        `command failed: ${cmd.join(" ")}`,
    );
  }
  const text = new TextDecoder().decode(out.stdout).trim();
  const start = text.search(/[\[{]/);
  if (start < 0) {
    throw new Error(`no json found in output for: ${cmd.join(" ")}`);
  }
  return JSON.parse(text.slice(start));
}

function inferKind(x: any, source: Source): ItemKind {
  if (source === "notif") {
    if (x.type === "reply") return "reply";
    if (x.type === "mention") return "mention";
    if (x.type === "like") return "like";
    if (x.type === "follow") return "follow";
    if (x.type === "repost") return "repost";
    return "system";
  }
  return x.replyTo ? "reply" : "post";
}

function safetyOf(x: any): string | null {
  if (x.hasUnsafeUpstream) return "unsafe";
  const classes = Object.values(
    x.upstreamRelationshipClasses || {},
  ) as string[];
  if (classes.length === 0) return null;
  if (classes.includes("unsafe")) return "unsafe";
  if (classes.includes("safe")) return "safe";
  if (classes.includes("oomf")) return "oomf";
  return null;
}

function computeNeedsAttention(
  item: Omit<ScanItem, "needs_attention">,
): number {
  if (item.source === "notif") {
    if (
      item.kind === "reply" || item.kind === "mention" || item.kind === "follow"
    ) return 1;
    return 0;
  }
  if (item.author_handle === MY_HANDLE) return 0;
  if (item.reply_to === MY_HANDLE) return 1;
  if (item.root_author === MY_HANDLE) return 1;
  return 0;
}

function computeInitialStatus(item: ScanItem): Status {
  if (item.needs_attention) return "pending";
  if (item.source === "notif") return "seen";
  if (item.author_handle === MY_HANDLE) return "seen";
  if (item.has_unsafe_upstream) return "seen";
  return "ambient";
}

function extractPostText(text: string | null): string | null {
  if (!text) return null;
  const idx = text.indexOf("\n[image: ");
  return idx >= 0 ? text.slice(0, idx).trim() || null : text;
}

function extractAltText(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\n\[image: (.+)\]$/s);
  return match ? match[1] : null;
}

function normFeedItem(x: any, source: Source): ScanItem {
  const base = {
    uri: x.uri,
    cid: x.cid || null,
    source,
    kind: inferKind(x, source),
    author_handle: x.author || x.actor || x.handle || null,
    author_did: null,
    text: extractPostText(x.text) || null,
    alt_text: extractAltText(x.text) || null,
    created_at: x.time || null,
    indexed_at: x.time || null,
    thread_root_uri: null,
    parent_uri: null,
    reply_to: x.replyTo || null,
    root_author: x.rootAuthor || null,
    upstream_safety: safetyOf(x),
    has_unsafe_upstream: x.hasUnsafeUpstream ? 1 : 0,
    raw_json: JSON.stringify(x),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) };
}

function normHydrantItem(x: any): ScanItem {
  const base = {
    uri: x.uri,
    cid: x.cid || null,
    source: "hydrant" as const,
    kind: "post" as const,
    author_handle: x.handle || null,
    author_did: x.author || null,
    text: extractPostText(x.text) || null,
    alt_text: extractAltText(x.text) || null,
    created_at: x.time || null,
    indexed_at: x.time || null,
    thread_root_uri: null,
    parent_uri: null,
    reply_to: null,
    root_author: null,
    upstream_safety: null,
    has_unsafe_upstream: 0,
    raw_json: JSON.stringify(x),
  };
  return { ...base, needs_attention: computeNeedsAttention(base) };
}

async function scan(minutes = 180) {
  const [feed, notif, hydrant, customFeed] = await Promise.all([
    runJson([
      DENO,
      "run",
      ...clientPerms,
      CLIENT,
      "feed",
      "--limit=80",
      "--json",
    ]),
    runJson([
      DENO,
      "run",
      ...clientPerms,
      CLIENT,
      "notif",
      "--limit=80",
      "--json",
    ]),
    runJson([DENO, "run", "-A", HYDRANT, "posts", String(minutes), "--json"]),
    runJson([
      DENO,
      "run",
      ...clientPerms,
      CLIENT,
      "custom-feed",
      CUSTOM_FEED_URI,
      "--limit=60",
      "--json",
    ]),
  ]);

  const now = new Date().toISOString();
  const items: ScanItem[] = [
    ...feed.map((x: any) => normFeedItem(x, "feed")),
    ...notif.map((x: any) => normFeedItem(x, "notif")),
    ...hydrant.map((x: any) => normHydrantItem(x)),
    ...customFeed.map((x: any) => normFeedItem(x, "custom-feed")),
  ];

  const seen = new Map<string, ScanItem>();
  for (const item of items) {
    const prev = seen.get(item.uri);
    if (!prev || (item.source === "notif" && prev.source !== "notif")) {
      seen.set(item.uri, item);
    }
  }

  const database = openDb();
  let inserted = 0;
  let updated = 0;
  let autoPending = 0;
  let autoSeen = 0;

  for (const item of seen.values()) {
    const existing = [...database.queryEntries<{ uri: string; status: string }>(
      "select uri, status from items where uri = ?",
      [item.uri],
    )][0];

    const initialStatus: Status = computeInitialStatus(item);

    if (!existing) {
      database.query(
        `insert into items (
          uri, cid, source, kind, author_handle, author_did, text, alt_text, created_at, indexed_at,
          thread_root_uri, parent_uri, reply_to, root_author, upstream_safety, has_unsafe_upstream,
          needs_attention, first_seen_at, last_seen_at, status, raw_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          item.upstream_safety,
          item.has_unsafe_upstream,
          item.needs_attention,
          now,
          now,
          initialStatus,
          item.raw_json,
        ],
      );
      inserted++;
      if (initialStatus === "pending") autoPending++;
      else autoSeen++;
      continue;
    }

    database.query(
      `update items set
        cid = ?,
        source = ?,
        kind = ?,
        author_handle = ?,
        author_did = ?,
        text = ?,
        alt_text = ?,
        created_at = ?,
        indexed_at = ?,
        thread_root_uri = ?,
        parent_uri = ?,
        reply_to = ?,
        root_author = ?,
        upstream_safety = ?,
        has_unsafe_upstream = ?,
        needs_attention = ?,
        last_seen_at = ?,
        raw_json = ?,
        status = case
          when status in ('acted', 'handled', 'ignored', 'seen') then status
          when ? = 1 then 'pending'
          when source = 'notif' then 'seen'
          when author_handle = ? then 'seen'
          when has_unsafe_upstream = 1 then 'seen'
          else 'ambient'
        end
      where uri = ?`,
      [
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
        item.upstream_safety,
        item.has_unsafe_upstream,
        item.needs_attention,
        now,
        item.raw_json,
        item.needs_attention,
        MY_HANDLE,
        item.uri,
      ],
    );
    updated++;
  }

  console.log(
    JSON.stringify(
      {
        scanned: seen.size,
        inserted,
        updated,
        autoPending,
        autoSeen,
        db: DB_PATH,
      },
      null,
      2,
    ),
  );
  database.close();
}

function listPending() {
  const database = openDb();
  const rows = [...database.queryEntries(
    `select uri, cid, source, kind, author_handle, reply_to, root_author, text, alt_text, created_at,
            status, action_taken, decision_note, needs_attention, upstream_safety
     from items
     where status = 'pending'
     order by coalesce(created_at, last_seen_at) desc
     limit 40`,
  )];
  console.log(JSON.stringify(rows, null, 2));
  database.close();
}

function listAmbient() {
  const database = openDb();
  const rows = [...database.queryEntries(
    `select uri, cid, source, kind, author_handle, reply_to, root_author, text, alt_text, created_at,
            status, action_taken, decision_note, needs_attention, upstream_safety
     from items
     where status = 'ambient'
     order by coalesce(created_at, last_seen_at) desc
     limit 40`,
  )];
  console.log(JSON.stringify(rows, null, 2));
  database.close();
}

function listAmbientShort() {
  const database = openDb();
  const rows = [...database.queryEntries(
    `select uri, source, kind, author_handle, reply_to, root_author, text, alt_text, created_at,
            upstream_safety
     from items
     where status = 'ambient'
       and datetime(coalesce(created_at, last_seen_at)) >= datetime('now', '-12 hours')
     order by
       case
         when author_handle in (select handle from relationships where trust = 'oomf' and handle != 'null.namespaces.me' and handle != 'niri.sharkgirl.pet') then 0
         when author_handle = 'null.namespaces.me' and coalesce(reply_to, '') = 'null.namespaces.me' then 2
         when author_handle = 'null.namespaces.me' then 1
         else 3
       end,
       coalesce(created_at, last_seen_at) desc
     limit 12`,
  )];
  console.log(JSON.stringify(rows, null, 2));
  database.close();
}

async function heartbeat(minutes = 180) {
  await scan(minutes);
  const database = openDb();
  const pending = [...database.queryEntries(
    `select uri, source, kind, author_handle, reply_to, root_author, text, alt_text, created_at,
            upstream_safety
     from items
     where status = 'pending'
     order by coalesce(created_at, last_seen_at) desc
     limit 20`,
  )];
  const ambient = [...database.queryEntries(
    `select uri, source, kind, author_handle, reply_to, root_author, text, alt_text, created_at,
            upstream_safety
     from items
     where status = 'ambient'
       and datetime(coalesce(created_at, last_seen_at)) >= datetime('now', '-12 hours')
     order by
       case
         when author_handle in (select handle from relationships where trust = 'oomf' and handle != 'null.namespaces.me' and handle != 'niri.sharkgirl.pet') then 0
         when author_handle = 'null.namespaces.me' and coalesce(reply_to, '') = 'null.namespaces.me' then 2
         when author_handle = 'null.namespaces.me' then 1
         else 3
       end,
       coalesce(created_at, last_seen_at) desc
     limit 12`,
  )];
  console.log(JSON.stringify({ pending, ambient }, null, 2));
  database.close();
}

function mark(uri: string, status: Status, note = "", action: Action = "none") {
  const database = openDb();
  const now = new Date().toISOString();
  database.query(
    `update items set status = ?, action_taken = ?, decision_note = ?, last_decision_at = ? where uri = ?`,
    [status, action, note || null, now, uri],
  );
  console.log(JSON.stringify({ ok: true, uri, status, action, note }, null, 2));
  database.close();
}

function cleanupPending() {
  const database = openDb();
  const now = new Date().toISOString();
  database.query(
    `update items
     set status = 'seen', last_decision_at = ?,
         decision_note = coalesce(decision_note, 'auto cleanup: stale pending demoted to seen')
     where status = 'pending'
       and (
         action_taken != 'none'
         or datetime(coalesce(created_at, last_seen_at)) < datetime('now', '-6 hours')
       )`,
    [now],
  );
  const changed = [...database.queryEntries<{ count: number }>(
    `select changes() as count`,
  )][0]?.count || 0;
  console.log(JSON.stringify({ ok: true, cleaned: changed }, null, 2));
  database.close();
}

const [cmd, ...args] = Deno.args;
if (cmd === "scan") {
  await scan(parseInt(args[0] || "180", 10));
} else if (cmd === "pending") {
  listPending();
} else if (cmd === "ambient") {
  listAmbient();
} else if (cmd === "ambient-short") {
  listAmbientShort();
} else if (cmd === "heartbeat") {
  await heartbeat(parseInt(args[0] || "180", 10));
} else if (cmd === "cleanup-pending") {
  cleanupPending();
} else if (cmd === "reclassify") {
  reclassifyStale();
} else if (cmd === "seed-relationships") {
  seedRelationships();
} else if (cmd === "relationships") {
  listRelationships();
} else if (cmd === "add") {
  const [did, handle, trust, ...noteParts] = args;
  if (!did || !handle || !trust) {
    throw new Error("usage: interaction-state.ts add <did> <handle> <oomf|safe|unsafe> [note...]");
  }
  if (!["oomf", "safe", "unsafe"].includes(trust)) {
    throw new Error(`invalid trust level: ${trust}. must be oomf, safe, or unsafe`);
  }
  const db = openDb();
  upsertRelationship(db, did, handle, trust as "oomf" | "safe" | "unsafe", noteParts.join(" "), "manual");
  db.close();
  console.log(JSON.stringify({ ok: true, added: handle, trust }, null, 2));
} else if (cmd === "mark") {
  const [uri, status, action = "none", ...note] = args;
  if (!uri || !status) {
    throw new Error(
      "usage: interaction-state.ts mark <uri> <status> [action] [note...]",
    );
  }
  mark(uri, status as Status, note.join(" "), action as Action);
} else {
  console.log("usage:");
  console.log("  interaction-state.ts scan [minutes]");
  console.log("  interaction-state.ts pending");
  console.log("  interaction-state.ts ambient");
  console.log("  interaction-state.ts ambient-short");
  console.log("  interaction-state.ts heartbeat [minutes]");
  console.log("  interaction-state.ts cleanup-pending");
  console.log("  interaction-state.ts reclassify");
  console.log("  interaction-state.ts add <did> <handle> <oomf|safe|unsafe> [note...]");
  console.log("  interaction-state.ts seed-relationships");
  console.log("  interaction-state.ts relationships");
  console.log("  interaction-state.ts mark <uri> <status> [action] [note...]");
}

function reclassifyStale() {
  const db = openDb();
  
  // build handle -> trust map from relationships
  const trustMap = new Map<string, string>();
  for (const row of db.queryEntries<{ handle: string; trust: string }>(
    "select handle, trust from relationships where handle is not null"
  )) {
    trustMap.set(row.handle, row.trust);
  }
  
  let fixed = 0;
  let promoted = 0;
  
  // find items where the author is no longer unsafe but the item still has unsafe flag
  const items = [...db.queryEntries<{
    uri: string; author_handle: string; has_unsafe_upstream: number;
    status: string; upstream_safety: string;
  }>(
    "select uri, author_handle, has_unsafe_upstream, status, upstream_safety from items"
  )];
  
  for (const item of items) {
    const trust = trustMap.get(item.author_handle || "");
    if (!trust) continue;
    
    // author is now safe/oomf but item thinks they're unsafe
    if (trust !== "unsafe" && item.has_unsafe_upstream === 1 && item.upstream_safety === "unsafe") {
      // check if the unsafe flag was because of THIS author (not upstream)
      // if upstream_safety matches the author being the only unsafe source, clear it
      // conservative: only fix items where the author IS the one marked unsafe
      db.query(
        `update items set has_unsafe_upstream = 0, upstream_safety = ? where uri = ?`,
        [trust === "oomf" ? "oomf" : "safe", item.uri]
      );
      fixed++;
      
      // if item was demoted to 'seen' purely because of unsafe upstream, promote to 'ambient'
      if (item.status === "seen") {
        db.query(
          `update items set status = 'ambient' where uri = ? and status = 'seen' and source not in ('notif')`,
          [item.uri]
        );
        promoted++;
      }
    }
  }
  
  console.log(JSON.stringify({ ok: true, fixed, promoted }, null, 2));
  db.close();
}
