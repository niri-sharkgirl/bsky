import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { toAtUri } from "./write.ts";

const OWN = "did:plc:sxywkdxliruthtz3j4nqqpd2";
const RK = "3mvto6zf6p62w";
const WANT = `at://${OWN}/app.bsky.feed.post/${RK}`;

Deno.test("at-uri passes through untouched", async () => {
  assertEquals(await toAtUri(WANT, undefined, OWN), WANT);
});

Deno.test("bare rkey resolves against own did", async () => {
  // the shape a notification hands you, and the one that published junk when
  // it was handed to `post` instead of a read command
  assertEquals(await toAtUri(RK, undefined, OWN), WANT);
});

Deno.test("bsky.app link resolves (did form, no network)", async () => {
  assertEquals(await toAtUri(`https://bsky.app/profile/${OWN}/post/${RK}`, undefined, OWN), WANT);
});

Deno.test("bsky.app link ignores query/fragment", async () => {
  assertEquals(await toAtUri(`https://bsky.app/profile/${OWN}/post/${RK}?ref=x#y`, undefined, OWN), WANT);
});

Deno.test("handle + rkey as two args", async () => {
  assertEquals(await toAtUri(OWN, RK, OWN), WANT);
});

Deno.test("garbage is rejected, not silently retried", async () => {
  // control: this must throw, or the suite above proves nothing
  await assertRejects(() => toAtUri("https://example.com/nope", undefined, OWN));
});
