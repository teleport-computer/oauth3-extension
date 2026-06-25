// Fixture Otter.ai API for the e2e demo — stands in for otter.ai/forward/api/v1 so
// the demo renders real rows through the actual otter plugin code (userId → /speeches
// → map), with no live Otter credentials. Point the server at it via OTTER_BASE.
const PORT = Number(Deno.env.get("PORT")) || 8077;

const speeches = [
  { otid: "OAAA", title: "Weekly eng sync", start_time: 1_718_726_400, hasPhotos: 0, live_status: "", word_count: 1240 },
  { otid: "OBBB", title: "Design review — oauth3 scoped tokens", start_time: 1_718_640_000, hasPhotos: 2, live_status: "", word_count: 3380 },
  { otid: "OCCC", title: "1:1 with Andrew", start_time: 1_718_553_600, hasPhotos: 0, live_status: "", word_count: 810 },
];

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/user")) return Response.json({ userid: "demo-user-1" });
  // Plugin queries source=owned and source=shared; return the set once so dedupe runs.
  if (url.pathname.endsWith("/speeches")) {
    return Response.json({ speeches: url.searchParams.get("source") === "owned" ? speeches : [] });
  }
  return new Response("not found", { status: 404 });
});
