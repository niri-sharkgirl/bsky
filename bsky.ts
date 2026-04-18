import { ok } from "npm:@atcute/client@4.2.1";
import type { ActorIdentifier, ResourceUri } from "npm:@atcute/lexicons@1.2.9";
import type {} from "npm:@atcute/bluesky@3.3.3";

import { getFromCache, readFeedCache, trunc } from "./lib/cache.ts";
import {
  listRelationships,
  openDb,
  seedRelationships,
  upsertRelationship,
} from "./lib/db.ts";
import { getAuthedClient, getOwnProfile, getSession, putOwnProfile } from "./lib/auth.ts";
import {
  fetchAuthorFeedView,
  fetchCustomFeedView,
  fetchNotificationsView,
  fetchTimelineView,
  flattenThread,
  printFeedView,
  printNotifView,
  walkAncestors,
} from "./lib/read.ts";
import {
  cleanupPending,
  heartbeat,
  listAmbient,
  listAmbientShort,
  listPending,
  mark,
  markTrackedAction,
  reclassifyStale,
  scan,
  upsertManualItem,
} from "./lib/state.ts";
import { buildFacets, chatFetch, deleteRecord, resolveCid, resolveHandle, resolveReplyRefs, writeRecord } from "./lib/write.ts";
import type { Action, RelationshipClass, Status } from "./lib/types.ts";

function parseCliOptions(argv: string[]) {
  const jsonFlag = argv.includes("--json");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const args = argv.filter((arg) =>
    arg !== "--json" && !arg.startsWith("--limit=")
  );
  return { jsonFlag, limit, args };
}

const [cmd, ...rest] = Deno.args;
const { jsonFlag, limit, args } = parseCliOptions(rest);

try {
  switch (cmd) {
    case "check": {
      const session = await getSession();
      console.log(`session ok: ${session.handle} (${session.did})`);
      break;
    }

    case "feed": {
      const { client, token } = await getAuthedClient();
      const view = await fetchTimelineView(client, token, limit || 50);
      if (jsonFlag) console.log(JSON.stringify(view.formatted, null, 2));
      else await printFeedView(view, token);
      break;
    }

    case "user-feed": {
      const handle = args[0];
      if (!handle) throw new Error("user-feed requires a handle");
      const { client, token } = await getAuthedClient();
      const view = await fetchAuthorFeedView(client, token, handle, limit || 30);
      if (jsonFlag) console.log(JSON.stringify(view.formatted, null, 2));
      else await printFeedView(view, token);
      break;
    }

    case "custom-feed": {
      const feedUri = args[0];
      if (!feedUri) throw new Error("custom-feed requires a feed generator uri");
      const { client, token } = await getAuthedClient();
      const view = await fetchCustomFeedView(
        client,
        token,
        feedUri,
        limit || 30,
      );
      if (jsonFlag) console.log(JSON.stringify(view.formatted, null, 2));
      else await printFeedView(view, token);
      break;
    }

    case "notifications":
    case "notif": {
      const { client, token } = await getAuthedClient();
      const view = await fetchNotificationsView(client, token, limit || 50);
      if (jsonFlag) console.log(JSON.stringify(view.formatted, null, 2));
      else await printNotifView(view, token);
      break;
    }

    case "thread": {
      const uri = args[0];
      if (!uri) throw new Error("thread requires a post uri");
      const { client } = await getAuthedClient();
      const thread = await ok(
        client.get("app.bsky.feed.getPostThread", {
          params: { uri: uri as ResourceUri, depth: 6 },
        }),
      );
      console.log(
        JSON.stringify(
          [...walkAncestors(thread.thread), ...flattenThread(thread.thread)],
          null,
          2,
        ),
      );
      break;
    }

    case "profile": {
      const handle = args[0];
      if (!handle) throw new Error("profile requires a handle");
      const { client } = await getAuthedClient();
      const profile = await ok(
        client.get("app.bsky.actor.getProfile", {
          params: { actor: handle as ActorIdentifier },
        }),
      );
      console.log(
        JSON.stringify(
          {
            handle: profile.handle,
            did: profile.did,
            displayName: profile.displayName,
            description: profile.description,
            followsCount: profile.followsCount,
            followersCount: profile.followersCount,
            postsCount: profile.postsCount,
            labels: profile.labels?.map((label: any) => label.val),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "set-bio": {
      const description = args.join(" ").trim();
      if (!description) throw new Error("set-bio requires text");
      const session = await getSession();
      const current = await getOwnProfile(session);
      await putOwnProfile(session, { ...current, description });
      console.log("updated bio");
      break;
    }

    case "follow": {
      const handle = args[0];
      if (!handle) throw new Error("follow requires a handle");
      const { session, did, token } = await getAuthedClient();
      const subjectDid = await resolveHandle(handle);
      const result = await writeRecord(
        "app.bsky.graph.follow",
        {
          $type: "app.bsky.graph.follow",
          subject: subjectDid,
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      const db = openDb();
      upsertManualItem(db, {
        uri: result.uri,
        cid: result.cid ?? null,
        source: "manual",
        kind: "follow",
        status: "acted",
        action: "followed",
        note: `followed ${handle}`,
        author_handle: session.handle,
        author_did: did,
        subject_did: subjectDid,
        subject_handle: handle,
        text: `followed @${handle}`,
        created_at: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        raw_json: JSON.stringify(result),
      });
      db.close();
      console.log("followed:", result.uri);
      break;
    }

    case "post": {
      const text = args.join(" ");
      if (!text) throw new Error("post requires text");
      const { session, did, token } = await getAuthedClient();
      const facets = await buildFacets(text);
      const createdAt = new Date().toISOString();
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt,
        langs: ["en"],
      };
      if (facets.length > 0) record.facets = facets;
      const result = await writeRecord("app.bsky.feed.post", record, did, token);
      const db = openDb();
      upsertManualItem(db, {
        uri: result.uri,
        cid: result.cid ?? null,
        source: "manual",
        kind: "post",
        status: "acted",
        action: "posted",
        note: "posted via bsky",
        author_handle: session.handle,
        author_did: did,
        text,
        created_at: createdAt,
        indexed_at: createdAt,
        raw_json: JSON.stringify(result),
      });
      db.close();
      console.log("posted:", result.uri);
      break;
    }

    case "quote": {
      const quoteUriIdx = args.findIndex((arg) => arg.startsWith("at://"));
      let quoteUri: string | undefined;
      let quoteCid: string | undefined;
      if (quoteUriIdx !== -1) {
        quoteUri = args[quoteUriIdx];
        const maybeCid = args[quoteUriIdx + 1];
        if (maybeCid && maybeCid.startsWith("bafy")) quoteCid = maybeCid;
      }
      if (!quoteUri) {
        throw new Error("quote requires an at:// uri of the post to quote");
      }
      const { session, did, token } = await getAuthedClient();
      if (!quoteCid) quoteCid = await resolveCid(quoteUri, did);
      const text = args.filter((arg) => arg !== quoteUri && arg !== quoteCid).join(" ");
      const facets = await buildFacets(text);
      const createdAt = new Date().toISOString();
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt,
        langs: ["en"],
        embed: {
          $type: "app.bsky.embed.record",
          record: { uri: quoteUri, cid: quoteCid },
        },
      };
      if (facets.length > 0) record.facets = facets;
      const result = await writeRecord("app.bsky.feed.post", record, did, token);
      const db = openDb();
      upsertManualItem(db, {
        uri: result.uri,
        cid: result.cid ?? null,
        source: "manual",
        kind: "quote",
        status: "acted",
        action: "quoted",
        note: "quoted via bsky",
        author_handle: session.handle,
        author_did: did,
        text,
        created_at: createdAt,
        indexed_at: createdAt,
        subject_uri: quoteUri,
        subject_cid: quoteCid,
        raw_json: JSON.stringify(result),
      });
      db.close();
      console.log("quoted:", result.uri);
      break;
    }

    case "reply": {
      const [parentUri, second, ...restArgs] = args;
      if (!parentUri) throw new Error("reply requires at least parentUri");
      const text = (second && second.startsWith("at://"))
        ? restArgs.join(" ")
        : [second, ...restArgs].filter(Boolean).join(" ");
      if (!text) throw new Error("reply requires text");

      const { session, did, token } = await getAuthedClient();
      const facets = await buildFacets(text);
      const refs = await resolveReplyRefs(parentUri, token);
      const createdAt = new Date().toISOString();
      const record: any = {
        $type: "app.bsky.feed.post",
        text,
        createdAt,
        langs: ["en"],
        reply: refs,
      };
      if (facets.length > 0) record.facets = facets;
      const result = await writeRecord("app.bsky.feed.post", record, did, token);
      await markTrackedAction(
        parentUri,
        "replied",
        "replied via bsky",
        token,
        { reply_uri: result.uri, reply_cid: result.cid ?? null },
      );
      const db = openDb();
      upsertManualItem(db, {
        uri: result.uri,
        cid: result.cid ?? null,
        source: "manual",
        kind: "reply",
        status: "acted",
        action: "replied",
        note: "reply created via bsky",
        author_handle: session.handle,
        author_did: did,
        text,
        created_at: createdAt,
        indexed_at: createdAt,
        parent_uri: refs.parent.uri,
        thread_root_uri: refs.root.uri,
        subject_uri: parentUri,
        subject_cid: refs.parent.cid,
        raw_json: JSON.stringify(result),
      });
      db.close();
      console.log("replied:", result.uri);
      break;
    }

    case "like": {
      const [uri, cidArg] = args;
      if (!uri) throw new Error("like requires post uri");
      const { session, did, token } = await getAuthedClient();
      const cid = cidArg || await resolveCid(uri, did);
      const result = await writeRecord(
        "app.bsky.feed.like",
        {
          $type: "app.bsky.feed.like",
          subject: { uri, cid },
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      await markTrackedAction(
        uri,
        "liked",
        "liked via bsky",
        token,
        { like_uri: result.uri, like_cid: result.cid ?? null },
      );
      console.log("liked:", result.uri);
      break;
    }

    case "cached":
    case "cached-search": {
      const query = cmd === "cached-search" ? args.join(" ").toLowerCase() : "";
      const cache = readFeedCache();
      if (cache.length === 0) {
        console.log("(no cached posts - run feed, notif, or user-feed first)");
        break;
      }
      for (const post of cache) {
        if (
          query &&
          !post.text.toLowerCase().includes(query) &&
          !post.author.toLowerCase().includes(query)
        ) continue;
        const time = new Date(post.time).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        });
        const prefix = post.isRepost ? `[repost by ${post.repostedBy}]` : "";
        console.log(`#${post.index} ${post.author} ${prefix}`);
        if (post.text) console.log(`  ${trunc(post.text, 120)}`);
        console.log(`  ${time}  ♥${post.likes} ↩${post.replies}  ${post.uri}`);
        console.log();
      }
      break;
    }

    case "like-n": {
      const index = parseInt(args[0], 10);
      if (!index) throw new Error("like-n requires an index number");
      const post = getFromCache(index);
      if (!post) throw new Error(`no post at index ${index} in cache`);
      const { session, did, token } = await getAuthedClient();
      const result = await writeRecord(
        "app.bsky.feed.like",
        {
          $type: "app.bsky.feed.like",
          subject: { uri: post.uri, cid: post.cid },
          createdAt: new Date().toISOString(),
        },
        did,
        token,
      );
      await markTrackedAction(
        post.uri,
        "liked",
        `liked via like-n #${index}`,
        token,
        { like_uri: result.uri, like_cid: result.cid ?? null },
      );
      console.log(`liked #${index}: ${post.author} - ${trunc(post.text, 60)}`);
      break;
    }

    case "reply-n": {
      const index = parseInt(args[0], 10);
      if (!index) throw new Error("reply-n requires an index number");
      const text = args.slice(1).join(" ");
      if (!text) throw new Error("reply-n requires text after the index");
      const post = getFromCache(index);
      if (!post) throw new Error(`no post at index ${index} in cache`);
      const { session, did, token } = await getAuthedClient();
      const facets = await buildFacets(text);
      const refs = await resolveReplyRefs(post.uri, token);
      const createdAt = new Date().toISOString();
      const result = await writeRecord(
        "app.bsky.feed.post",
        {
          $type: "app.bsky.feed.post",
          text,
          facets,
          createdAt,
          langs: ["en"],
          reply: refs,
        },
        did,
        token,
      );
      await markTrackedAction(
        post.uri,
        "replied",
        `replied via reply-n #${index}`,
        token,
        { reply_uri: result.uri, reply_cid: result.cid ?? null },
      );
      const db = openDb();
      upsertManualItem(db, {
        uri: result.uri,
        cid: result.cid ?? null,
        source: "manual",
        kind: "reply",
        status: "acted",
        action: "replied",
        note: `reply created via reply-n #${index}`,
        author_handle: session.handle,
        author_did: did,
        text,
        created_at: createdAt,
        indexed_at: createdAt,
        parent_uri: refs.parent.uri,
        thread_root_uri: refs.root.uri,
        subject_uri: post.uri,
        subject_cid: post.cid,
        subject_handle: post.author,
        raw_json: JSON.stringify(result),
      });
      db.close();
      console.log(`replied #${index}: ${post.author} - "${text}"`);
      break;
    }

    case "delete": {
      const uri = args[0];
      if (!uri) throw new Error("delete requires a uri");
      const { token } = await getAuthedClient();
      await deleteRecord(uri, token);
      console.log("deleted:", uri);
      break;
    }

    case "dm-list": {
      const { did, token } = await getAuthedClient();
      const data = await chatFetch("chat.bsky.convo.listConvos?limit=50", token);
      const convos = data.convos || [];
      if (jsonFlag) console.log(JSON.stringify(convos, null, 2));
      else if (convos.length === 0) console.log("no conversations yet");
      else {
        for (const convo of convos) {
          const other = convo.members?.find((member: any) => member.did !== did);
          const handle = other?.handle || other?.did || "?";
          const name = other?.displayName || "";
          const unread = convo.unreadCount || 0;
          const status = convo.status || "open";
          const label = unread > 0 ? ` (${unread} unread)` : "";
          console.log(
            `[${convo.id}] ${name ? name + " " : ""}@${handle}${label} [${status}]`,
          );
        }
      }
      break;
    }

    case "dm-messages": {
      const convoId = args[0];
      if (!convoId) throw new Error("dm-messages requires a conversation id");
      const { did, token } = await getAuthedClient();
      const data = await chatFetch(
        `chat.bsky.convo.getMessages?convoId=${convoId}&limit=${limit || 30}`,
        token,
      );
      const messages = data.messages || [];
      if (jsonFlag) console.log(JSON.stringify(messages, null, 2));
      else {
        for (const message of messages) {
          const sender = message.sender?.handle || message.sender?.did || "?";
          const prefix = message.sender?.did === did ? "me" : sender;
          const time = message.sentAt ? new Date(message.sentAt).toLocaleString() : "";
          console.log(`[${time}] ${prefix}: ${message.text || "(no text)"}`);
        }
      }
      break;
    }

    case "dm-send": {
      const recipient = args[0];
      const text = args.slice(1).join(" ");
      if (!recipient || !text) {
        throw new Error("usage: dm-send <handle|did> <text>");
      }
      const { token } = await getAuthedClient();
      const recipientDid = await resolveHandle(recipient);
      let convoId: string;
      try {
        const convoData = await chatFetch(
          `chat.bsky.convo.getConvoForMembers?members=${recipientDid}`,
          token,
        );
        convoId = convoData.convo.id;
      } catch {
        throw new Error(
          `could not start conversation with ${recipient}: they may have DMs restricted`,
        );
      }
      const message = await chatFetch("chat.bsky.convo.sendMessage", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convoId,
          message: {
            text,
            createdAt: new Date().toISOString(),
            $type: "chat.bsky.convo.defs#messageInput",
          },
        }),
      });
      console.log(`sent to ${recipient} (convo ${convoId}): ${text}`);
      console.log(`message id: ${message.id}`);
      break;
    }

    case "dm-reply": {
      const convoId = args[0];
      const text = args.slice(1).join(" ");
      if (!convoId || !text) {
        throw new Error("usage: dm-reply <convo-id> <text>");
      }
      const { token } = await getAuthedClient();
      const message = await chatFetch("chat.bsky.convo.sendMessage", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          convoId,
          message: {
            text,
            createdAt: new Date().toISOString(),
            $type: "chat.bsky.convo.defs#messageInput",
          },
        }),
      });
      console.log(`sent in convo ${convoId}: ${text}`);
      console.log(`message id: ${message.id}`);
      break;
    }

    case "scan":
      console.log(JSON.stringify(await scan(parseInt(args[0] || "180", 10)), null, 2));
      break;
    case "pending":
      console.log(JSON.stringify(listPending(), null, 2));
      break;
    case "ambient":
      console.log(JSON.stringify(listAmbient(), null, 2));
      break;
    case "ambient-short":
      console.log(JSON.stringify(listAmbientShort(), null, 2));
      break;
    case "heartbeat":
      console.log(JSON.stringify(await heartbeat(parseInt(args[0] || "180", 10)), null, 2));
      break;
    case "cleanup-pending":
      console.log(JSON.stringify(cleanupPending(), null, 2));
      break;
    case "reclassify":
      console.log(JSON.stringify(reclassifyStale(), null, 2));
      break;
    case "seed-relationships":
      seedRelationships();
      break;
    case "relationships":
      console.log(JSON.stringify(listRelationships(), null, 2));
      break;
    case "add": {
      const [did, handle, trust, ...noteParts] = args;
      if (!did || !handle || !trust) {
        throw new Error("usage: bsky.ts add <did> <handle> <oomf|safe|unsafe> [note...]");
      }
      if (!["oomf", "safe", "unsafe"].includes(trust)) {
        throw new Error(`invalid trust level: ${trust}. must be oomf, safe, or unsafe`);
      }
      const db = openDb();
      upsertRelationship(
        db,
        did,
        handle,
        trust as RelationshipClass,
        noteParts.join(" "),
        "manual",
      );
      db.close();
      console.log(JSON.stringify({ ok: true, added: handle, trust }, null, 2));
      break;
    }
    case "mark": {
      const [uri, status, action = "none", ...note] = args;
      if (!uri || !status) {
        throw new Error("usage: bsky.ts mark <uri> <status> [action] [note...]");
      }
      console.log(
        JSON.stringify(
          mark(uri, status as Status, note.join(" "), action as Action),
          null,
          2,
        ),
      );
      break;
    }

    default:
      console.error("usage: bsky.ts <command> [args...] [--json] [--limit=N]");
      console.error(
        "commands: check, feed, user-feed, custom-feed, notif, thread, profile, set-bio, follow, post, quote, reply, like, like-n, reply-n, cached, cached-search, delete",
      );
      console.error("  dm-list, dm-messages, dm-send, dm-reply");
      console.error(
        "  scan, pending, ambient, ambient-short, heartbeat, cleanup-pending, reclassify, add, seed-relationships, relationships, mark",
      );
      Deno.exit(1);
  }
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  Deno.exit(1);
}
