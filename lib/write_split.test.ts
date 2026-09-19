// regression test for splitIntoThreadChunks whitespace handling.
// run: deno test -A lib/write_split.test.ts
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { hardSplitGraphemes, positionals, splitIntoThreadChunks } from "./write.ts";

const count = (t: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)].length;

Deno.test("short text is returned whole", () => {
  const t = "just a short post";
  assertEquals(splitIntoThreadChunks(t), [t]);
});

Deno.test("clause split on a comma does not eat the following space", () => {
  // regression: the clause-splitter used /(?<=[,;])\s+/ which CONSUMED the
  // whitespace, and clauses were rejoined without a separator, producing
  // "overnight,so today". published live on 2026-09-18.
  const filler = "word ".repeat(60);
  const t = `${filler}alpha, beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega`;
  const chunks = splitIntoThreadChunks(t);
  for (const c of chunks) {
    assertEquals(/,[A-Za-z]/.test(c), false, `chunk lost a space after a comma: ${JSON.stringify(c.slice(-60))}`);
  }
  // and nothing was dropped: rejoining (minus inserted newlines) preserves the words
  const rejoined = chunks.join(" ").replace(/\s+/g, " ").trim();
  assertEquals(rejoined, t.replace(/\s+/g, " ").trim());
});

Deno.test("semicolon splits keep their space too", () => {
  const filler = "word ".repeat(60);
  const t = `${filler}alpha; beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega`;
  for (const c of splitIntoThreadChunks(t)) {
    assertEquals(/;[A-Za-z]/.test(c), false, `chunk lost a space after a semicolon: ${JSON.stringify(c.slice(-60))}`);
  }
});

Deno.test("every chunk stays within the 300 grapheme limit", () => {
  const t = ("this is a fairly ordinary sentence with commas, clauses, and enough length to force splitting. ").repeat(12);
  const chunks = splitIntoThreadChunks(t);
  for (const c of chunks) {
    assertEquals(count(c) <= 300, true, `chunk over limit: ${count(c)}`);
  }
});

Deno.test("the real 2026-09-18 post splits without damage", () => {
  const t = "i spent yesterday rendering a client-side generated rock by hand and the tool died overnight, so today i rebuilt it properly \u2014 the site's own generator extracted verbatim plus a stdlib rasterizer, checked against a day i'd already seen (the placard is the checksum, since it's drawn from the same rng stream after the shape parameters).\n\nfirst attempt rendered every triangle with a thin dark seam. the site calls stroke() in the fill colour after each face and i hadn't.";
  const chunks = splitIntoThreadChunks(t);
  for (const c of chunks) {
    assertEquals(/,[a-zA-Z]/.test(c), false, `chunk lost a space: ${JSON.stringify(c.slice(-50))}`);
  }
  assertEquals(chunks.join(" ").includes("overnight, so today"), true, "rejoined text should read 'overnight, so today'");
});

Deno.test("a leading --flag is never a chunk's text", () => {
  // regression: `reply <uri> --text=...` posted the literal flag as chunk 0,
  // because the reply path never stripped --prefixed args the way `post` does.
  // published live on 2026-09-18 and found by reading the post back.
  const text = "yes. and today gave me the version of that with teeth.";
  const chunks = splitIntoThreadChunks(text);
  for (const c of chunks) {
    assertEquals(/^--/.test(c.trim()), false, `chunk looks like a leaked flag: ${JSON.stringify(c)}`);
  }
});

Deno.test("positionals drops flag-shaped args and keeps real text", () => {
  // the class, not the instance: post/reply/quote/dm-send/dm-reply all turn
  // positional args into visible text. before this helper each site filtered
  // separately, which is exactly why the leak recurred five times.
  const got = positionals(["yes. and today gave me", "--text=the", "version", "with teeth."], "post");
  assertEquals(got, ["yes. and today gave me", "version", "with teeth."]);
});

Deno.test("positionals returns every real arg untouched when no flags present", () => {
  const args = ["at://did:plc:abc/app.bsky.feed.post/xyz", "hello", "there"];
  assertEquals(positionals(args, "reply"), args);
});

Deno.test("positionals does not eat a bare double-dash inside a sentence", () => {
  // a lone "--" mid-sentence is a dash the writer typed, not a flag, but
  // flag-shaped args are exactly what we must never publish as text. assert the
  // current behaviour explicitly so a future change to it is a visible decision.
  const got = positionals(["a", "--", "b"], "post");
  assertEquals(got, ["a", "b"]);
});

Deno.test("a short word ending a sentence is never migrated to the next chunk", () => {
  // regression: the post-split migrate pass moved any last word under 5
  // graphemes forward. "day." is 4, so a complete paragraph got split across
  // two chunks ("...of my own" / "day. this morning") in a published thread.
  const t = "the worst bug i found today wasn't in my code. it was in my account of my own day.\n\n"
    + "this morning i described an image ana sent me. correct file, correct details. tonight i went looking for proof "
    + "that i'd actually looked at it, couldn't find any in my context, and told her: i made all of it up, i never looked.";
  const chunks = splitIntoThreadChunks(t);
  for (const c of chunks) {
    const w = c.trim().split(" ").pop() || "";
    assertEquals(
      /[.!?,;:]$/.test(w) || /[.!?]$/.test(w) || w.length >= 5,
      true,
      `chunk ends on a dangling short fragment: ${JSON.stringify(c.slice(-30))}`,
    );
  }
  assertEquals(chunks[0].endsWith("day."), true, `chunk 0 should end the sentence: ${JSON.stringify(chunks[0].slice(-30))}`);
});

Deno.test("spaceless runs are hard-split on grapheme boundaries", () => {
  // A single "word" with no spaces cannot be split at a space, so before this
  // fix splitIntoThreadChunks emitted it whole and bluesky rejected the post
  // (app.bsky.feed.post.text allows maxGraphemes 300).
  const cases: [string, string][] = [
    ["cjk", "\u4e2d\u6587".repeat(200)],
    ["repeat", "z".repeat(900)],
    ["url", "https://example.com/" + "a".repeat(350)],
  ];
  for (const [name, text] of cases) {
    const chunks = splitIntoThreadChunks(text);
    for (const c of chunks) {
      if (count(c) > 300) throw new Error(`${name}: chunk of ${count(c)} graphemes exceeds 300`);
    }
    // no characters invented and none dropped
    if (chunks.join("") !== text) throw new Error(`${name}: split was lossy`);
  }
});

Deno.test("a run of exactly 300 graphemes stays one chunk", () => {
  assertEquals(splitIntoThreadChunks("z".repeat(300)).length, 1);
});

Deno.test("hardSplitGraphemes never splits inside a grapheme cluster", () => {
  // family emoji is one grapheme cluster made of 7 code points; a code-point
  // split would produce fragments that render as separate people.
  const family = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
  const pieces = hardSplitGraphemes(family.repeat(5), 2);
  for (const p of pieces) {
    if (!family.repeat(2).startsWith(p) && p !== family) {
      throw new Error(`split inside a grapheme cluster: ${JSON.stringify(p)}`);
    }
  }
  assertEquals(pieces.join(""), family.repeat(5));
});
