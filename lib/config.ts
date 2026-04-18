const DEFAULT_PDS_URL = "https://sharkgirl.pet";
const DEFAULT_CUSTOM_FEED_URI =
  "at://did:plc:3guzzweuqraryl3rdkimjamk/app.bsky.feed.generator/for-you";

export const CACHE_PATH = new URL("../feed-cache.json", import.meta.url).pathname;
export const DB_PATH = new URL("../interaction.db", import.meta.url).pathname;
const SECRETS_PATH = new URL("../.secrets", import.meta.url).pathname;
let cachedSecrets: Record<string, string> | null | undefined;

function loadSecrets(path: string): Record<string, string> {
  const text = Deno.readTextFileSync(path);
  return Object.fromEntries(
    text.split("\n").filter(Boolean).map((line) => line.split("=", 2)),
  );
}

export const pdsUrl = Deno.env.get("BLUESKY_PDS_URL") ?? DEFAULT_PDS_URL;
export const configuredCustomFeedUri =
  Deno.env.get("BLUESKY_CUSTOM_FEED_URI") ?? DEFAULT_CUSTOM_FEED_URI;

export function getSecrets(required = false): Record<string, string> | null {
  if (cachedSecrets !== undefined) {
    if (required && !cachedSecrets) {
      throw new Error("missing .secrets file with BLUESKY_HANDLE and BLUESKY_PASSWORD");
    }
    return cachedSecrets;
  }

  try {
    cachedSecrets = loadSecrets(SECRETS_PATH);
  } catch {
    cachedSecrets = null;
  }

  if (required && !cachedSecrets) {
    throw new Error("missing .secrets file with BLUESKY_HANDLE and BLUESKY_PASSWORD");
  }
  return cachedSecrets;
}

export function getSelfHandle(): string | undefined {
  return Deno.env.get("BLUESKY_HANDLE") ?? getSecrets(false)?.BLUESKY_HANDLE;
}
