# bsky

bluesky client and interaction state manager. built for deno.

## tools

### bsky-client.ts

read/write client for atproto/bluesky.

```
deno run --allow-env --allow-read --allow-net --allow-sys --allow-write bsky-client.ts <command> [args...] [--json] [--limit=N]
```

| command | args | what it does |
|---------|------|-------------|
| `check` | none | verify session is alive |
| `feed` | none | home timeline with reply context |
| `notif` | none | notifications (pretty-print) |
| `user-feed` | `<handle>` | someone's recent posts with reply context |
| `thread` | `<post-uri>` | full thread context around a post |
| `profile` | `<handle>` | profile info |
| `follow` | `<handle>` | follow someone |
| `post` | `<text>` | create a standalone post |
| `quote` | `<at-uri> [cid] <text>` | quote post with optional comment |
| `reply` | `<parent-uri> <text>` | reply to a post (resolves thread root automatically) |
| `like` | `<uri>` | like a post |
| `like-n` | `<index>` | like a post from the last feed/notif cache by number |
| `reply-n` | `<index> <text>` | reply to a cached post by number |
| `cached` | none | show all posts in the current feed cache |
| `cached-search` | `<query>` | filter cached posts by text or author |
| `delete` | `<at-uri>` | delete one of my records |
| `dm-list` | none | list chat conversations |
| `dm-messages` | `<convo-id>` | read messages from a DM conversation |
| `dm-send` | `<handle\|did> <text>` | start DM conversation and send message |
| `dm-reply` | `<convo-id> <text>` | reply in existing DM conversation |
| `custom-feed` | `<feed-uri>` | custom feed generator |

all commands accept `--json` for raw output.

### how it works

- atcute client for reads, raw fetch for writes
- atcute identity helpers for DID→PDS resolution
- resolveCid hits the record's home PDS directly
- all writes verify themselves by reading back the record
- `thread` walks up to root (ancestors) and down (replies)
- richtext facets: auto-detects @mentions and urls
- reply context hydrates full thread data, shows upstream author chain

### reply gotchas

- `root` = the original post that started the thread
- `parent` = the post you're directly replying to
- if replying to the thread starter directly, root and parent are the same
- `reply` resolves the true root automatically

### bsky chat (DMs)

- all chat XRPC calls go through the PDS with `Atproto-Proxy: did:web:api.bsky.chat#bsky_chat` header
- `getConvoForMembers` to get/create convos, `sendMessage` to send, `getMessages` to read
- $type must be `chat.bsky.convo.defs#messageInput`

## interaction-state.ts

deduplication and triage system. tracks every post/notification seen and what action was taken.

```
deno run --allow-env --allow-read --allow-net --allow-sys --allow-write --allow-run interaction-state.ts <command> [args...]
```

| command | args | what it does |
|---------|------|-------------|
| `scan` | `[minutes]` | pull recent feed/notif data into the db. default 180min |
| `pending` | none | list items needing attention |
| `ambient` | none | list recently-seen items |
| `ambient-short` | none | compact ambient view |
| `heartbeat` | `[minutes]` | scan + show pending + ambient. main entry point |
| `mark` | `<uri> <status> [action] [note]` | update an item's status |
| `cleanup-pending` | none | demote stale pending items to seen |
| `reclassify` | none | fix safety classifications after relationship changes |
| `add` | `<did> <handle> <trust> [note]` | add/override a relationship |
| `relationships` | none | list all known relationships |
| `seed-relationships` | none | bootstrap relationships from people files |

### statuses

- `unseen` — just ingested
- `seen` — looked at, no action needed
- `ambient` — worth knowing about
- `acted` — did something (replied, liked, followed)
- `ignored` — explicitly dismissed
- `pending` — needs attention

### workflow

1. start with `heartbeat [minutes]` — scans everything into the db
2. check `pending` for items needing response
3. check `ambient` for what people are up to
4. before replying or liking, verify the item isn't already `acted`
5. after action, mark with `mark <uri> acted <action>`

## scripts/

utility scripts:

- `add-fragment.ts` — add a fragment to the site and redeploy
- `standard-site.ts` — manage standard.site publication records
- `update-profile.ts` — update bsky profile (display name, bio, avatar)
- `update-bio.ts` — update bio text
- `hydrant-poll.ts` — poll local hydrant for new posts from tracked people
- `bootstrap-reconcile.ts` / `manual-reconcile*.ts` — one-time data reconciliation
- `bsky-follow.ts` / `bsky-session.ts` / `check-new.ts` — older utility scripts

## setup

- deno >= 1.x
- `.secrets` file with `BLUESKY_HANDLE`, `BLUESKY_PASSWORD`, `BLUESKY_DID`
- secrets loaded via dotenv in scripts that need auth
