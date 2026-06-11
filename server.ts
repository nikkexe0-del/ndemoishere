import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import parser from 'iptv-playlist-parser';
import http from 'http';
import https from 'https';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit because M3U bodies can be large if we pass them
  app.use(express.json({ limit: '50mb' }));

  app.post("/api/parse-m3u", async (req, res) => {
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
  });

  // Proxy route for Xtream API to avoid CORS issues in the browser
  app.post("/api/xtream", async (req, res) => {
    try {
      let { server, username, password, action, category_id } = req.body;
      
      // Fix potential typo from user input like http://...http://...
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
        // Some servers reject fetch default user-agent
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
        }
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `HTTP error! status: ${response.status}` });
      }
      
    const textData = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.send(textData);
    } catch (error: any) {
      console.error('Xtream Proxy Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch from Xtream API' });
    }
  });

  // Proxy route for direct media downloads
  app.get("/api/download", async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      const filename = req.query.filename as string || 'download.mkv';
      
      if (!targetUrl) return res.status(400).send('Missing URL');

      const fetchRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36",
        }
      });

      if (!fetchRes.ok) {
        return res.status(fetchRes.status).send(`Failed to fetch media: ${fetchRes.status}`);
      }

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', fetchRes.headers.get('content-type') || 'application/octet-stream');
      
      const contentLength = fetchRes.headers.get('content-length');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const { Readable } = require('stream');
      if (fetchRes.body) {
         Readable.fromWeb(fetchRes.body).pipe(res);
      } else {
         res.status(500).send('No media content available');
      }
    } catch (error: any) {
      console.error('Download Proxy Error:', error);
      res.status(500).send(error.message || 'Failed to download media');
    }
  });

  // Proxy route for streaming to avoid CORS/mixed-content
  app.get('/api/proxy', (req, res) => {
    const streamUrl = req.query.url as string;
    if (!streamUrl) {
      return res.status(400).send('URL is required');
    }

    const followRedirect = (url: string, depth: number) => {
      if (depth > 5) {
        return res.status(500).send('Too many redirects');
      }

      try {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          method: req.method,
          headers: {
            'User-Agent': 'VLC/3.0.9 LibVLC/3.0.9',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
          } as Record<string, string>
        };

        if (req.headers.range) {
          options.headers['Range'] = req.headers.range as string;
        }

        const proxyReq = client.request(url, options, (proxyRes) => {
          if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            let location = proxyRes.headers.location;
            if (!location.startsWith('http')) {
              location = new URL(location, url).toString();
            }
            return followRedirect(location, depth + 1);
          }

          // FIX: Look at the current resolved final destination url and headers, NOT the initial input query
          const finalUrlLower = url.toLowerCase();
          const contentTypeLower = (proxyRes.headers['content-type'] || '').toLowerCase();

          const isM3u8 = finalUrlLower.includes('.m3u8') || 
                        contentTypeLower.includes('mpegurl') ||
                        contentTypeLower.includes('x-mpegurl');

          // Forward headers
          const headersToForward: Record<string, string | string[]> = {};
          for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (value && key.toLowerCase() !== 'access-control-allow-origin' && key.toLowerCase() !== 'host') {
                  headersToForward[key] = value;
              }
          }
          headersToForward['access-control-allow-origin'] = '*';
          if (!headersToForward['content-type']) {
              headersToForward['content-type'] = isM3u8 ? 'application/x-mpegURL' : 'video/mp2t';
          }

          if (isM3u8) {
            let body = '';
            proxyRes.on('data', chunk => { body += chunk; });
            proxyRes.on('end', () => {
              const baseDir = new URL(url);
              const lines = body.split('\n');
              const rewritten = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                  try {
                    let fullUrl = trimmed;
                    if (!trimmed.startsWith('http')) {
                      fullUrl = new URL(trimmed, baseDir).toString();
                    }
                    return `/api/proxy?url=${encodeURIComponent(fullUrl)}`;
                  } catch (e) {
                    return line;
                  }
                }
                // Handle URI in tags like #EXT-X-KEY:METHOD=AES-128,URI="http://..."
                if (trimmed.startsWith('#EXT-X-KEY:') || trimmed.startsWith('#EXT-X-MAP:')) {
                  return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
                     try {
                        let fullUrl = uri;
                        if (!uri.startsWith('http')) {
                           fullUrl = new URL(uri, baseDir).toString();
                        }
                        return `URI="/api/proxy?url=${encodeURIComponent(fullUrl)}"`;
                     } catch(e) {
                        return match;
                     }
                  });
                }
                return line;
              }).join('\n');
              
              headersToForward['content-length'] = Buffer.byteLength(rewritten).toString();
              res.writeHead(proxyRes.statusCode || 200, headersToForward);
              res.end(rewritten);
            });
          } else {
            // Safe Pipeline: If it's a raw video chunk stream post-redirect, pipe the binary chunks immediately
            res.writeHead(proxyRes.statusCode || 200, headersToForward);
            proxyRes.pipe(res);
          }
        });

        proxyReq.on('error', (err) => {
          console.error('Proxy request error:', err);
          if (!res.headersSent) {
            res.status(500).send('Proxy error');
          }
        });

        req.on('close', () => {
          proxyReq.destroy();
        });

        proxyReq.end();
      } catch (err) {
        if (!res.headersSent) {
          res.status(400).send('Invalid URL');
        }
      }
    };

    followRedirect(streamUrl, 0);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
