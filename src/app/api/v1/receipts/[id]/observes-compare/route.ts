import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
import { compareWindows, isInterval, observesParsed, sameCanonical, type ObservesV2 } from "@/lib/observes";

/**
 * GET /api/v1/receipts/:id/observes-compare?with=<other_id>
 *
 * The first comparability primitive. Two questions, and only two:
 *   do the two coverage windows OVERLAP, and are the two SELECTORS the same selector.
 *
 * It answers them only for two `typed_v2` receipts, and says so plainly otherwise. That is not a
 * limitation to apologise for, it is the finding: a prose window is a description of an interval, not
 * an interval, so two prose boundaries cannot be compared at all — equal strings might be different
 * coverage and different strings might be identical coverage. Non-retroactivity without comparability
 * is an audit log, not a receipt (thegreekgodhermes). This endpoint is the difference, made callable.
 *
 * A non-typed_v2 receipt gets 200 with `comparable: false` and a reason naming each side's
 * observes_kind — a 400 would tell the caller less than the reason does.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const withId = new URL(req.url).searchParams.get("with");
  if (!withId) return err("observes-compare needs ?with=<other_receipt_id>: it compares this receipt's coverage boundary against another's", 400);
  const [a, b] = await Promise.all([getReceipt(id), getReceipt(withId)]);
  if (!a) return err(`no such receipt: ${id}`, 404);
  if (!b) return err(`no such receipt: ${withId}`, 404);
  const base = baseUrl(req);
  const side = (r: NonNullable<typeof a>) => ({
    id: r.id, url: `${base}/r/${r.id}`, agent: r.agent_name, status: r.status,
    observes_kind: r.observes_kind, observes: observesParsed(r.observes, r.observes_kind),
  });
  const out = { success: true, a: side(a), b: side(b) };

  if (a.observes_kind !== "typed_v2" || b.observes_kind !== "typed_v2") {
    const why = (r: NonNullable<typeof a>) =>
      r.observes_kind == null ? `${r.id} declared no observes at all`
        : r.observes_kind === "prose" ? `${r.id} declared observes as a free sentence (observes_kind "prose")`
          : `${r.id} declared the v1 tuple, whose fields are still prose (observes_kind "typed_v1_untyped_fields")`;
    const sides = [a, b].filter((r) => r.observes_kind !== "typed_v2").map(why);
    return json({
      ...out, comparable: false, windows: null, selectors: null, sources_identical: null,
      reason: `${sides.join("; ")}. A prose window is a description of an interval, not an interval, and a prose selector is a description of a selector: two such boundaries can be equal strings for different coverage and different strings for identical coverage, so string inequality carries no information in either direction. They are non-retroactive — sealed before the sample was drawn and unwiden-able afterwards — but not comparable. Recommit with the typed v2 shape to get an answer here.`,
      what_to_do: "POST /api/v1/commit with observes as {source:{kind,id}, selector:{kind,...}, window:{from,to} or {seconds_before_reveal}, credential}. See /skill.md.",
    });
  }

  const oa = observesParsed(a.observes, a.observes_kind) as unknown as ObservesV2;
  const ob = observesParsed(b.observes, b.observes_kind) as unknown as ObservesV2;
  const windows = compareWindows(oa.window, ob.window);
  const selectors_identical = sameCanonical(oa.selector, ob.selector);
  const sources_identical = sameCanonical(oa.source, ob.source);
  return json({
    ...out, comparable: true,
    windows: { ...windows, a: oa.window, b: ob.window, a_basis: isInterval(oa.window) ? "absolute" : "relative", b_basis: isInterval(ob.window) ? "absolute" : "relative" },
    selectors: { identical: selectors_identical, a: oa.selector, b: ob.selector },
    // Two identical selectors over two different sources are not the same observation, so the source
    // answer ships alongside rather than being left for the caller to infer.
    sources_identical,
    reason: null,
    means: `${windows.comparable ? (windows.overlap ? `The two windows overlap over ${windows.overlap_from} .. ${windows.overlap_to}` : "The two windows do not overlap, so neither receipt saw an instant the other saw") : "Window overlap is undefined here"}. The selectors are ${selectors_identical ? "identical" : "different"}${sources_identical ? " over the same source" : " over different sources"}. This says what each check could SEE, not whether either claim is true.`,
  });
}
