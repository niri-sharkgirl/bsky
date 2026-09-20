// regression tests for trust lookup across handle changes.
// run: deno test -A lib/relationship_lookup.test.ts
//
// the bug these exist for: trust used to be looked up by handle only. a handle
// is a mutable string — people rename, and handles get taken by somebody else —
// so a rename silently demoted a person to `unsafe` (kira, 2026-09; ana's old
// main handle; dawn's alt) and a recycled handle handed my label to a stranger
// (digi.rip, mfzx.net). the did is the identity. trust follows the did.
import { assertEquals } from "jsr:@std/assert@1";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
import { getRelationshipClass, loadRelationshipLookup } from "./db.ts";

const KIRA = "did:plc:2tqqxubv2lu4ahj35ysjer2r";
const OLD_OWNER = "did:plc:oldgoneunregistered000000";
const STRANGER = "did:plc:erqwpimsmwnzohwoiojsy22z";

async function fixture(): Promise<{ lookup: ReturnType<typeof loadRelationshipLookup>; cleanup: () => Promise<void> }> {
  const tmp = await Deno.makeTempFile({ suffix: ".db" });
  const db = new DB(tmp);
  db.execute(`create table relationships (
    did text primary key, handle text, trust text not null, note text,
    source text not null default 'manual', updated_at text not null)`);
  db.query(`insert into relationships values (?,?,?,?,?,?)`,
    [KIRA, "kira.pds.witchcraft.systems", "oomf", null, "seed", "2026-03-30"]);
  db.query(`insert into relationships values (?,?,?,?,?,?)`,
    [OLD_OWNER, "digi.rip", "safe", null, "manual", "2026-04-04"]);
  const lookup = loadRelationshipLookup(db);
  db.close();
  return { lookup, cleanup: () => Deno.remove(tmp) };
}

Deno.test("a renamed handle keeps its did's trust", async () => {
  const { lookup, cleanup } = await fixture();
  try {
    assertEquals(getRelationshipClass(lookup, "kira.ws", KIRA), "oomf");
  } finally { await cleanup(); }
});

Deno.test("a handle taken by a different did does not carry the label", async () => {
  const { lookup, cleanup } = await fixture();
  try {
    assertEquals(getRelationshipClass(lookup, "digi.rip", STRANGER), "unsafe");
    // control: the person the row was written for still has it
    assertEquals(getRelationshipClass(lookup, "digi.rip", OLD_OWNER), "safe");
  } finally { await cleanup(); }
});

Deno.test("handle-only lookup still works when there is no did", async () => {
  const { lookup, cleanup } = await fixture();
  try {
    assertEquals(getRelationshipClass(lookup, "kira.pds.witchcraft.systems"), "oomf");
  } finally { await cleanup(); }
});

Deno.test("a total stranger is unsafe, and a missing handle is too", async () => {
  const { lookup, cleanup } = await fixture();
  try {
    assertEquals(getRelationshipClass(lookup, "nobody.example", "did:plc:who000000000000000000"), "unsafe");
    assertEquals(getRelationshipClass(lookup, undefined, "did:plc:who000000000000000000"), "unsafe");
    assertEquals(getRelationshipClass(lookup, undefined, undefined), "unsafe");
  } finally { await cleanup(); }
});
