
import { toAtUri } from "./write.ts";
const OWN = "did:plc:sxywkdxliruthtz3j4nqqpd2";
// A real, non-self post — the case that previously reached resolveReplyRefs
// as a non-AT-URI and died with "could not resolve parent post".
const H = "claire.on-her.computer";
const RK = "3mvwygjjlp22n";
Deno.test("bsky.app link to somebody else's post resolves to their DID", async () => {
  const got = await toAtUri(`https://bsky.app/profile/${H}/post/${RK}`, undefined, OWN);
  if (!got.startsWith("at://did:plc:")) throw new Error("not a did uri: " + got);
  if (got.endsWith(OWN + "/app.bsky.feed.post/" + RK)) throw new Error("resolved to OUR did, not theirs");
});
Deno.test("handle + rkey resolves to somebody else's DID", async () => {
  const got = await toAtUri(H, RK, OWN);
  if (!got.startsWith("at://did:plc:")) throw new Error("not a did uri: " + got);
  if (got.endsWith(OWN + "/app.bsky.feed.post/" + RK)) throw new Error("resolved to OUR did");
});
Deno.test("bare rkey self-scopes to our own DID (by design)", async () => {
  const got = await toAtUri(RK, undefined, OWN);
  if (got !== `at://${OWN}/app.bsky.feed.post/${RK}`) throw new Error("wrong: " + got);
});
