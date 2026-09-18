export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  const q = String(req.query.q || '').trim();
  const league = String(req.query.league || '').trim().toLowerCase();

  if (!/^[a-z0-9 _.-]{1,8}$/i.test(q)) {
    return res.status(400).json({ error: 'Invalid prefix' });
  }
  if (!/^lg[a-z0-9_-]{2,20}$/.test(league)) {
    return res.status(400).json({ error: 'Invalid league slug' });
  }

  const url = new URL('https://chelscout.net/api/suggest');
  url.searchParams.set('q', q);
  url.searchParams.set('league', league);

  try {
    const upstream = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'Wildman-Hockey-Scouting/1.0'
      },
      redirect: 'follow'
    });

    const text = await upstream.text();
    let body;
    try { body = JSON.parse(text); }
    catch { body = { error: 'ChelScout returned a non-JSON response.' }; }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'ChelScout request was not accepted.',
        status: upstream.status
      });
    }

    const results = Array.isArray(body?.results) ? body.results : [];
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(502).json({ error: 'ChelScout is temporarily unreachable.' });
  }
}
