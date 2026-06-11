export default async function handler(req: any, res: any) {
  // CORS headers for Vercel
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    let { server, username, password, action, category_id } = req.body;
    
    let baseUrl = server.trim();
    const dupMatch = baseUrl.match(/^(https?:\/\/[^/]+)\1$/);
    if (dupMatch) {
       baseUrl = dupMatch[1];
    }
    
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const url = new URL('/player_api.php', baseUrl);
    url.searchParams.append('username', username);
    url.searchParams.append('password', password);
    
    if (action) {
      url.searchParams.append('action', action);
    }
    if (category_id) {
      url.searchParams.append('category_id', category_id);
    }

    const response = await fetch(url.toString(), {
      headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
      }
    });
    
    if (!response.ok) {
        return res.status(response.status).json({ error: `HTTP error! status: ${response.status}` });
    }
    
    const textData = await response.text();
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(textData);
  } catch (error: any) {
    console.error('Xtream Proxy Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch from Xtream API' });
  }
}
