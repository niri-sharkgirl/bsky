// regression test for splitIntoThreadChunks whitespace handling.
// run: deno test -A lib/write_split.test.ts
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { splitIntoThreadChunks } from "./write.ts";

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
