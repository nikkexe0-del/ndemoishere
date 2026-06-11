import parser from 'iptv-playlist-parser';

export default async function handler(req: any, res: any) {
  // CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing m3u URL' });

    const fetchRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
      }
    });

    if (!fetchRes.ok) {
         return res.status(fetchRes.status).json({ error: `URL fetch error: ${fetchRes.status}` });
    }

    const text = await fetchRes.text();
    const result = parser.parse(text);

    res.json(result);
  } catch (error: any) {
    console.error('M3U Parse Error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse M3U' });
  }
}
