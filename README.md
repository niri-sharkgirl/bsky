# bsky

Modular Bluesky client and interaction-state manager for Deno.

## entrypoint

```sh
deno run --allow-env --allow-read --allow-net --allow-sys --allow-write bsky.ts <command> [args...] [--json] [--limit=N]
```

## commands

| command | args | what it does |
|---------|------|--------------|
| `check` | none | verify session is alive |
| `feed` | none | home timeline with reply context |
| `notif` | none | notifications with reply context |
| `user-feed` | `<handle>` | someone's recent posts |
| `custom-feed` | `<feed-uri>` | fetch a generator feed |
| `thread` | `<post-uri>` | full thread context around a post |
| `profile` | `<handle>` | profile info |
| `set-bio` | `<text>` | update your profile description |
| `follow` | `<handle>` | follow someone |
| `post` | `<text>` | create a standalone post |
| `quote` | `<at-uri> [cid] <text>` | quote a post |
| `reply` | `<parent-uri> <text>` | reply to a post |
| `like` | `<uri> [cid]` | like a post |
| `like-n` | `<index>` | like a cached post |
| `reply-n` | `<index> <text>` | reply to a cached post |
| `cached` | none | show cached feed/notif items |
| `cached-search` | `<query>` | search cached items |
| `delete` | `<at-uri>` | delete one of your records |
| `dm-list` | none | list DM conversations |
| `dm-messages` | `<convo-id>` | read a DM thread |
| `dm-send` | `<handle\|did> <text>` | start/send a DM |
| `dm-reply` | `<convo-id> <text>` | reply in an existing DM |
| `scan` | `[minutes]` | ingest recent feed/notif/custom-feed items into the DB |
| `pending` | none | list items needing attention |
| `ambient` | none | list recently seen ambient items |
| `ambient-short` | none | compact ambient view |
| `heartbeat` | `[minutes]` | scan + show pending + ambient |
| `cleanup-pending` | none | demote stale pending items |
| `reclassify` | none | recompute safety-based item status |
| `seed-relationships` | none | seed relationships table |
| `relationships` | none | list all relationships |
| `add` | `<did> <handle> <trust> [note]` | add/override a relationship |
| `mark` | `<uri> <status> [action] [note]` | manually update an item's state |

## structure

- `bsky.ts` is the only CLI entrypoint.
- `lib/auth.ts` handles auth/session/profile writes.
- `lib/read.ts` owns thread hydration and feed/notif fetching.
- `lib/write.ts` owns record writes, CID/handle resolution, and DMs.
- `lib/state.ts` owns normalization, heartbeat, and interaction-state actions.
- `lib/db.ts` owns SQLite schema and relationship/item persistence.
- `lib/cache.ts` owns feed cache helpers and shared text helpers.

## state behavior

- `heartbeat` runs internally and ingests local hydrant posts directly when a hydrant index is available.
- `post`, `quote`, `reply`, `like`, and `follow` now write through the interaction-state layer directly.
- Reply and feed scans now populate `parent_uri` and `thread_root_uri` instead of leaving them mostly empty.
- Thread reads stay read-only.

## setup

- Deno with `nodeModulesDir` enabled via `deno.json`
- `.secrets` file with `BLUESKY_HANDLE` and `BLUESKY_PASSWORD`
- optional env vars:
  - `BLUESKY_PDS_URL`
  - `BLUESKY_CUSTOM_FEED_URI`

## note

The repo history was rewritten to remove the old sensitive `scripts/bsky.mjs`, and `git filter-repo` removed the `origin` remote as part of that process. Re-add your remote before the next push.
