(() => {
  if (!window.supabase) return;
  const gameId = new URLSearchParams(location.search).get("id");
  if (!gameId) return;
  const db = window.supabase.createClient("https://lrgllzvwgvqagcpiyvfd.supabase.co", "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP");
  async function addLink() {
    const { data } = await db.from("esports_game_reports").select("game_id,headline,status").eq("game_id", gameId).eq("status", "published").maybeSingle();
    if (!data) return;
    const root = document.getElementById("networkGameDetail"); if (!root || document.getElementById("publishedPostgameLink")) return;
    const bar = document.createElement("div"); bar.id = "publishedPostgameLink"; bar.className = "postgame-link-bar";
    bar.innerHTML = `<a class="small-btn primary" href="postgame.html?id=${encodeURIComponent(gameId)}">Read Postgame Report →</a>`;
    root.prepend(bar);
  }
  setTimeout(addLink, 900);
  setTimeout(addLink, 3500);
})();
