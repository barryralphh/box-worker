// Stable front door for the box. Cloudflare Worker, no dependencies.
// Secrets it needs: BOX_TOKEN (the easi.run agent token) and PATH_KEY (a long random string that goes in the URL).
//   /                        -> redirects a person to the box's current admin page
//   /<PATH_KEY>/mcp          -> the box's MCP endpoint
//   /<PATH_KEY>/api/agent/*  -> the box's REST API
const LINK_URL = "https://barryralphh.github.io/box-link/link.txt";
const MCP_VERSION = "2025-06-18";
const OK_VERSIONS = new Set(["2025-06-18", "2025-11-25", "2026-07-28"]);

async function currentBase() {
  const r = await fetch(`${LINK_URL}?t=${Math.floor(Date.now() / 20000)}`, { cf: { cacheTtl: 15, cacheEverything: true } });
  if (!r.ok) throw new Error("link.txt " + r.status);
  const base = (await r.text()).trim();
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw new Error("bad link");
  return base;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      try {
        return Response.redirect((await currentBase()) + "/", 302);
      } catch (e) {
        return new Response("The box is restarting. Try again in a minute.", { status: 503 });
      }
    }
    const parts = url.pathname.split("/");
    if (!env.PATH_KEY || !env.BOX_TOKEN || !parts[1] || !same(parts[1], env.PATH_KEY)) {
      return new Response("Not found", { status: 404 });
    }
    const rest = "/" + parts.slice(2).join("/");
    if (!(rest === "/mcp" || rest.startsWith("/api/agent/"))) return new Response("Not found", { status: 404 });

    let base;
    try {
      base = await currentBase();
    } catch (e) {
      return json({ error: "box_unavailable", detail: "Could not read the box address. Try again in a minute." }, 503);
    }
    const h = new Headers(request.headers);
    for (const k of [...h.keys()]) {
      if (k.startsWith("cf-") || k.startsWith("x-forwarded") || k === "host" || k === "x-real-ip") h.delete(k);
    }
    h.set("authorization", "Bearer " + env.BOX_TOKEN);
    h.set("accept-encoding", "identity");
    if (rest === "/mcp") {
      const v = h.get("mcp-protocol-version");
      if (!v || !OK_VERSIONS.has(v)) h.set("mcp-protocol-version", MCP_VERSION);
    }
    try {
      const upstream = await fetch(base + rest + url.search, {
        method: request.method,
        headers: h,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        duplex: "half",
        redirect: "manual",
      });
      return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    } catch (e) {
      return json({ error: "box_unreachable", detail: "The box may be restarting. Try again in 2 to 3 minutes." }, 502);
    }
  },
};
