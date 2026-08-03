/**
 * Cloudflare Pages Functions catch-all for /api/* — only reached when no more specific
 * function file matches (candles.ts, quote.ts, review.ts, feedback.ts, symbols.ts,
 * plan/interpret.ts, plan/revise.ts all take precedence per Cloudflare's file-routing
 * precedence: exact > parametric > catch-all).
 *
 * Without this, an unmatched /api/* request would fall through past Functions to static
 * assets, find nothing, and then hit the SPA fallback in public/_redirects
 * (`/* /index.html 200`) — silently returning the HTML app shell with a 200 instead of an
 * honest 404. _redirects itself cannot express a 404 (Cloudflare only allows 301/302/303/
 * 307/308 there), so this catch-all Function is the correct mechanism.
 */
export const onRequest: PagesFunction = async () => {
  return Response.json({ error: { code: "not_found", message: "Unknown API route" } }, { status: 404 });
};
