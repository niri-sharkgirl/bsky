const HYDRANT = "http://localhost:7980";

interface Record {
  uri: string;
  cid: string;
  value: {
    text?: string;
    createdAt?: string;
    reply?: { root: { uri: string }; parent: { uri: string } };
    [k: string]: unknown;
  };
}

const people: Record<string, string> = {};

async function loadPeople() {
  const res = await fetch(`${HYDRANT}/repos`);
  const text = await res.text();
  for (const line of text.trim().split("\n")) {
    try {
      const r = JSON.parse(line);
      if (r.handle && r.did) people[r.did] = r.handle;
    } catch {
      // skip malformed lines
    }
  }
}

async function getRecentPosts(did: string, since: Date, limit = 20): Promise<Record[]> {
  const res = await fetch(
    `${HYDRANT}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.feed.post&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const records: Record[] = data.records || [];
  return records.filter((r) => {
    const created = r.value?.createdAt ? new Date(r.value.createdAt) : null;
    return created && created > since;
  });
}

const [cmd, ...args] = Deno.args;
const sinceMinutes = parseInt(args[0] || "15", 10);
const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
const jsonMode = args.includes("--json");

await loadPeople();

if (cmd === "posts") {
  const allPosts: { author: string; handle: string; text: string; time: string; uri: string }[] = [];
  for (const [did, handle] of Object.entries(people)) {
    const posts = await getRecentPosts(did, since);
    for (const p of posts) {
      allPosts.push({
        author: did,
        handle,
        text: p.value.text || "",
        time: p.value.createdAt || "",
        uri: p.uri,
      });
    }
  }
  allPosts.sort((a, b) => a.time.localeCompare(b.time));
  if (jsonMode) {
    console.log(JSON.stringify(allPosts, null, 2));
  } else {
    for (const p of allPosts) {
      const time = new Date(p.time).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
      });
      console.log(`${time} ${p.handle}`);
      if (p.text) console.log(`  ${p.text.slice(0, 300)}`);
      console.log(`  ${p.uri}`);
      console.log();
    }
  }
}

if (!cmd || cmd === "help") {
  console.log("usage: hydrant-poll.ts posts [minutes] [--json]");
  console.log("  posts    show new posts from tracked people since N minutes ago (default 15)");
}
