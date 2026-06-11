import React, { useState, useEffect, useMemo } from 'react';
import { Play, Copy, Search, MonitorPlay, Film, Tv, Download, AlertCircle, Check, Folder, List, LayoutGrid, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VideoPlayer } from './components/VideoPlayer';

const AppleSpinner = () => {
  return (
    <div className="w-6 h-6 relative flex items-center justify-center">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="absolute w-[2px] h-[5px] bg-slate-400 rounded-full"
          style={{
            transformOrigin: '50% 10px',
            transform: `rotate(${i * 30}deg) translateY(-7px)`,
            animation: `ios-spin 1s linear infinite`,
            animationDelay: `${-(12 - i) * (1 / 12)}s`
          }}
        />
      ))}
      <style>{`
        @keyframes ios-spin {
          0% { opacity: 1; }
          100% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
};

type StreamItem = {
  num: number | string;
  name: string;
  stream_type: string;
  stream_id: number | string;
  stream_icon: string;
  category_id: string;
  container_extension?: string;
  rating?: string | number;
  url?: string; // Direct URL from M3U
};

type CategoryItem = {
  category_id: string;
  category_name: string;
  parent_id?: number;
};

export default function App() {
  const [serverUrl, setServerUrl] = useState("http://premiumtvs.space:80");
  const [username, setUsername] = useState("jen12345");
  const [password, setPassword] = useState("Jen54321");
  
  const [status, setStatus] = useState<"idle" | "loading" | "connected" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  
  const [view, setView] = useState<"main" | "presets">("main");
  const [presets, setPresets] = useState<{server: string, username: string, password: string}[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);

  const [streams, setStreams] = useState<StreamItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [streamType, setStreamType] = useState<"live" | "vod" | "series" | "m3u">("live");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(48);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [playingStream, setPlayingStream] = useState<StreamItem | null>(null);

  const getFullPlaylistUrl = () => {
    let url = serverUrl.trim();
    if (url.includes('.m3u') || (!username && !password)) return url;
    if (url.endsWith('/')) url = url.slice(0, -1);
    return `${url}/get.php?username=${username}&password=${password}&type=m3u_plus`;
  };

  useEffect(() => {
    setVisibleCount(48);
  }, [searchQuery, streamType, selectedCategories]);

  const loadPresets = async () => {
    if (presets.length > 0) {
      setView("presets");
      return;
    }
    setPresetsLoading(true);
    setView("presets");
    try {
      const cacheBust = new Date().getTime();
      const res = await fetch(`https://raw.githubusercontent.com/nikkexe0-del/alexplaylist/refs/heads/main/xtream.json?t=${cacheBust}`);
      const text = await res.text();
      const blocks = text.trim().split(/\n\s*\n/);
      const parsed = blocks.map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        let server = '', username = '', password = '';

        const m3uLine = lines.find(l => l.includes('username=') && l.includes('password='));
        
        if (m3uLine) {
           try {
               // Extract just the URL part if there are prefixes like "Url: "
               const urlMatch = m3uLine.match(/(https?:\/\/[^\s]+)/);
               if (urlMatch) {
                   const urlObj = new URL(urlMatch[1]);
                   username = urlObj.searchParams.get('username') || '';
                   password = urlObj.searchParams.get('password') || '';
                   server = `${urlObj.protocol}//${urlObj.host}`;
                   if (urlObj.port) {
                       server += `:${urlObj.port}`;
                   }
               }
           } catch(e) {}
        }
        
        if (!server || !username || !password) {
           server = lines[0] ? lines[0].replace(/^(url|server|host):\s*/i, '').replace(/^string\s+/i, '') : '';
           username = lines[1] ? lines[1].replace(/^(user|username):\s*/i, '') : '';
           password = lines[2] ? lines[2].replace(/^(pass|password):\s*/i, '') : '';
        }

        return { server, username, password };
      }).filter(p => p.server && p.username && p.password);
      setPresets(parsed);
    } catch (e) {
      console.error("Failed to load presets", e);
    } finally {
      setPresetsLoading(false);
    }
  };

  const usePreset = (p: {server: string, username: string, password: string}) => {
    setServerUrl(p.server);
    setUsername(p.username);
    setPassword(p.password);
    setView("main");
  };

  const handlePastedContent = (val: string, setter: (v: string) => void) => {
    try {
      if (val.includes('username=') && val.includes('password=')) {
        const urlMatch = val.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
            const urlObj = new URL(urlMatch[1]);
            const user = urlObj.searchParams.get('username');
            const pass = urlObj.searchParams.get('password');
            
            if (user) setUsername(user);
            if (pass) setPassword(pass);
            
            let host = `${urlObj.protocol}//${urlObj.host}`;
            if (urlObj.port) {
                host += `:${urlObj.port}`;
            }
            setServerUrl(host);
            return;
        }
      }
    } catch(e) {}
    
    setter(val);
  };

  const handleConnect = async (type: "live" | "vod" | "series" | "m3u") => {
    setStatus("loading");
    setStreamType(type);
    setErrorMsg("");
    setStreams([]);
    setCategories([]);
    setVisibleCount(48);
    
    try {
      if (type === "m3u") {
        let fullM3uUrl = serverUrl;
        if (!serverUrl.includes('.m3u') && username && password) {
          fullM3uUrl = `${serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl}/get.php?username=${username}&password=${password}&type=m3u_plus`;
        }
        const res = await fetch("/api/parse-m3u", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: fullM3uUrl })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to parse M3U');
        
        const parsedStreams: StreamItem[] = [];
        const catsMap = new Map<string, string>();
        
        data.items.forEach((item: any, idx: number) => {
          const catName = item.group?.title || "Uncategorized";
          const catId = catName; // we'll use name as ID for M3U parsing
          if (!catsMap.has(catId)) {
            catsMap.set(catId, catName);
          }
          
          parsedStreams.push({
            num: idx,
            name: item.name || `Stream ${idx}`,
            stream_type: "m3u",
            stream_id: idx,
            stream_icon: item.tvg?.logo || "",
            category_id: catId,
            url: item.url
          });
        });

        const parsedCats: CategoryItem[] = Array.from(catsMap.entries()).map(([id, name]) => ({
          category_id: id,
          category_name: name
        }));

        setStreams(parsedStreams);
        setCategories(parsedCats);
        setSelectedCategories([]);
        setStatus("connected");

      } else {
        // ... (xtream API implementation code logic)
        let action = "";
        let catAction = "";
        
        if (type === "live") { action = "get_live_streams"; catAction = "get_live_categories"; }
        else if (type === "vod") { action = "get_vod_streams"; catAction = "get_vod_categories"; }
        else if (type === "series") { action = "get_series"; catAction = "get_series_categories"; }
        
        const fetchApi = async (act: string) => {
          const res = await fetch("/api/xtream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ server: serverUrl, username, password, action: act })
          });
          
          if (!res.ok) {
            let errorText = `HTTP error ${res.status}`;
            try {
              const errJson = await res.json();
              errorText = errJson.error || errorText;
            } catch (e) {
              // ignore and use default status-based error
            }
            throw new Error(errorText);
          }
          
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (e) {
            console.error("Failed to parse JSON reply:", text.slice(0, 500));
            throw new Error("The IPTV provider returned an invalid format instead of JSON. Ensure your server URL is correct.");
          }
        };

        const [streamsData, catsData] = await Promise.all([
          fetchApi(action),
          fetchApi(catAction).catch(() => [])
        ]);

        // Smart parser for Streams Data
        let parsedStreams: any[] = [];
        if (Array.isArray(streamsData)) {
          parsedStreams = streamsData;
        } else if (typeof streamsData === 'object' && streamsData !== null) {
          const uInfo = streamsData.user_info || streamsData.userInfo;
          if (uInfo && (uInfo.auth === 0 || uInfo.auth === "0")) {
            throw new Error("Failed to authenticate: Invalid username or password.");
          }
          
          // Locate any array inside the object (handles wrapper responses)
          const arrayKey = Object.keys(streamsData).find(k => Array.isArray((streamsData as any)[k]));
          if (arrayKey) {
            parsedStreams = (streamsData as any)[arrayKey];
          } else {
            parsedStreams = Object.entries(streamsData)
              .filter(([k, v]) => k !== 'user_info' && k !== 'userInfo' && k !== 'server_info' && typeof v === 'object' && v !== null)
              .map(([_, v]) => v);
          }
        }

        const mapped = parsedStreams.map(a => ({
           ...a,
           stream_id: a.stream_id ?? a.series_id,
           stream_icon: a.stream_icon ?? a.cover,
           name: a.name ?? a.title
        }));
        setStreams(mapped);

        // Smart parser for Categories Data
        let parsedCats: any[] = [];
        if (Array.isArray(catsData)) {
          parsedCats = catsData;
        } else if (typeof catsData === 'object' && catsData !== null) {
          const arrayKey = Object.keys(catsData).find(k => Array.isArray((catsData as any)[k]));
          if (arrayKey) {
            parsedCats = (catsData as any)[arrayKey];
          } else {
            parsedCats = Object.entries(catsData)
              .filter(([k, v]) => k !== 'user_info' && k !== 'userInfo' && k !== 'server_info' && typeof v === 'object' && v !== null)
              .map(([_, v]) => v);
          }
        }
        setCategories(parsedCats);
        setSelectedCategories([]);
        setStatus("connected");
      }
      
    } catch (err: any) {
      console.error(err);
      setStatus("error");
      setErrorMsg(err.message || "Failed to connect to server. Ensure URL, username, and password are correct.");
    }
  };

  const getStreamLink = (item: StreamItem) => {
    if (item.url) return item.url; // From M3U

    let baseUrl = serverUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    
    if (streamType === "live") {
      return `${baseUrl}/live/${username}/${password}/${item.stream_id}.m3u8`;
    } else if (streamType === "vod") {
      const ext = item.container_extension || "mp4";
      return `${baseUrl}/movie/${username}/${password}/${item.stream_id}.${ext}`;
    } else if (streamType === "series") {
      const ext = item.container_extension || "mp4";
      return `${baseUrl}/series/${username}/${password}/${item.stream_id}.${ext}`;
    }
    return "";
  };

  const handleExportM3U = () => {
    if (!filteredStreams.length) return;
    
    let m3uContent = "#EXTM3U\n";
    filteredStreams.forEach(stream => {
      const logo = stream.stream_icon ? ` tvg-logo="${stream.stream_icon}"` : "";
      
      const category = categories.find(c => c.category_id == stream.category_id);
      const groupTitle = category ? category.category_name : 'Uncategorized';
      const group = ` group-title="${groupTitle}"`;
      
      const baseName = stream.name || `Stream ${stream.stream_id}`;
      const name = `${baseName} @nikshep`;
      
      const link = getStreamLink(stream);
      m3uContent += `#EXTINF:-1${logo}${group},${name}\n${link}\n`;
    });

    const blob = new Blob([m3uContent], { type: 'audio/mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zestyyxtream_${streamType}_custom.m3u`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  const handleDownloadSingleStream = (stream: StreamItem) => {
    const link = getStreamLink(stream);
    const name = stream.name ? stream.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : `stream_${stream.stream_id || 'unknown'}`;
    
    // Download media file via proxy if it is a VOD / Movie / Series
    if (streamType === "vod" || streamType === "series" || link.match(/\.(mkv|mp4|avi|mov|m4v|ts)$/i)) {
      const extMatch = link.match(/\.([a-z0-9]+)(\?.*)?$/i);
      const ext = extMatch ? extMatch[1] : (streamType === "vod" ? "mp4" : "mkv");
      const filename = `${name}.${ext}`;
      
      const downloadUrl = `/api/download?url=${encodeURIComponent(link)}&filename=${encodeURIComponent(filename)}`;
      
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.target = '_blank'; // Failsafe in case browser opens it
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // Default to downloading an m3u8 playlist for live streams
    const m3uContent = `#EXTM3U\n#EXTINF:-1,${stream.name || name}\n${link}\n`;
    const blob = new Blob([m3uContent], { type: 'audio/mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.m3u8`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = (link: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link)
        .then(() => {
          setCopiedLink(link);
          setTimeout(() => setCopiedLink(null), 2000);
        })
        .catch(err => {
            console.error("Clipboard API failed: ", err);
            fallbackCopy(link);
        });
    } else {
      fallbackCopy(link);
    }
  };

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "absolute";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedLink(text);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (err) {
      console.error('Fallback copy failed', err);
    }
    document.body.removeChild(textArea);
  };

  const toggleCategory = (catId: string) => {
    if (catId === "all") {
      setSelectedCategories([]);
    } else {
      setSelectedCategories(prev => {
        if (prev.includes(catId)) {
          return prev.filter(c => c !== catId);
        } else {
          return [...prev, catId];
        }
      });
    }
    setVisibleCount(48);
  };

  const filteredStreams = useMemo(() => {
    let result = streams;
    
    if (selectedCategories.length > 0) {
      result = result.filter(s => selectedCategories.includes(s.category_id));
    }
    
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(s => s.name?.toLowerCase().includes(lowerQuery));
    }
    
    return result;
  }, [searchQuery, streams, selectedCategories]);

  const visibleStreams = filteredStreams.slice(0, visibleCount);

  // Pagination for Player
  const playingIndex = playingStream ? filteredStreams.findIndex(s => s.stream_id === playingStream.stream_id) : -1;
  const hasNext = playingIndex !== -1 && playingIndex < filteredStreams.length - 1;
  const hasPrev = playingIndex > 0;

  const handleNext = () => {
    if (hasNext) setPlayingStream(filteredStreams[playingIndex + 1]);
  };

  const handlePrev = () => {
    if (hasPrev) setPlayingStream(filteredStreams[playingIndex - 1]);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans selection:bg-indigo-500/30">
      <AnimatePresence>
        {playingStream && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col"
          >
            <div className="p-4 flex items-center justify-between pointer-events-none absolute top-0 left-0 right-0 z-[60]">
               <button 
                 onClick={() => setPlayingStream(null)}
                 className="p-2 sm:p-3 bg-white/10 hover:bg-red-500/80 backdrop-blur-md rounded-full text-white transition-colors pointer-events-auto shadow-lg"
                 title="Close Player"
               >
                 <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
               </button>
            </div>
            <div className="flex-1 w-full h-full flex items-center justify-center">
              <div className="w-full h-full mx-auto flex items-center justify-center bg-black">
                <VideoPlayer 
                  url={getStreamLink(playingStream)} 
                  title={playingStream.name || `Stream ${playingStream.stream_id || ''}`} 
                  onPlaybackFailed={() => console.warn('Playback failed')}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  hasNext={hasNext}
                  hasPrev={hasPrev}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="max-w-[1400px] mx-auto px-4 py-8">
        
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <MonitorPlay className="w-8 h-8 text-indigo-500" />
              zestyyxtream
            </h1>
            <p className="mt-1 text-slate-400 font-medium">Xtream Link Extractor by zestyy</p>
          </div>
          <div>
            {view === "main" ? (
              <button
                onClick={loadPresets}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg font-medium transition-colors"
              >
                <LayoutGrid className="w-5 h-5" />
                Working Presets
              </button>
            ) : (
              <button
                onClick={() => setView("main")}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 rounded-lg font-medium transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back to Extractor
              </button>
            )}
          </div>
        </header>

        {view === "presets" ? (
          <div className="bg-slate-800 rounded-2xl shadow-sm border border-slate-700/60 p-8 min-h-[600px]">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Community Presets</h2>
              <p className="text-slate-400">Select a known working server to immediately load its connection details.</p>
            </div>
            
            {presetsLoading ? (
               <div className="flex flex-col items-center justify-center p-12 text-indigo-400">
                  <AppleSpinner />
                  <p className="mt-4 font-medium text-slate-300">Loading Presets...</p>
               </div>
            ) : presets.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <AlertCircle className="w-12 h-12 mb-4 text-slate-600" />
                  <p>No presets could be loaded at this time.</p>
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {presets.map((p, i) => (
                  <div key={i} className="flex flex-col bg-slate-900 border border-slate-700 rounded-xl p-6 hover:border-indigo-500/50 hover:shadow-lg transition-all group">
                    <div className="flex items-start gap-4 mb-4">
                      <div className="w-12 h-12 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                        <MonitorPlay className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-white truncate" title={p.server}>
                          {p.server.replace(/^https?:\/\//, '')}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">User: {p.username}</p>
                      </div>
                    </div>
                    <div className="mt-auto pt-4 border-t border-slate-800">
                      <button 
                        onClick={() => usePreset(p)}
                        className="w-full py-2 bg-slate-800 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors border border-slate-700 hover:border-indigo-500"
                      >
                        Use This Connection
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-8">
          {/* Controls Sidebar */}
          <div className="w-full lg:w-80 flex-shrink-0 space-y-6">
            <div className="bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-700/60">
              <h2 className="text-lg font-semibold mb-4 text-white">Connection Details</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Server URL or M3U Link</label>
                  <input 
                    type="text" 
                    value={serverUrl}
                    onChange={(e) => handlePastedContent(e.target.value, setServerUrl)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm text-white placeholder-slate-500"
                    placeholder="http://server:port or pasted full m3u url"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Username</label>
                  <input 
                    type="text" 
                    value={username}
                    onChange={(e) => handlePastedContent(e.target.value, setUsername)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
                  <input 
                    type="text" 
                    value={password}
                    onChange={(e) => handlePastedContent(e.target.value, setPassword)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow text-sm text-white"
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <button 
                  onClick={() => handleConnect("m3u")}
                  disabled={status === "loading"}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 px-4 rounded-lg font-medium transition-all disabled:opacity-70 disabled:scale-95 active:scale-95"
                >
                  {status === "loading" && streamType === "m3u" ? <AppleSpinner /> : <List className="w-4 h-4" />}
                  Fetch M3U Playlist
                </button>
                <div className="text-center text-xs text-slate-500 font-medium my-1">— OR USE XTREAM API —</div>
                <button 
                  onClick={() => handleConnect("live")}
                  disabled={status === "loading"}
                  className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white py-2.5 px-4 rounded-lg font-medium transition-all disabled:opacity-70 disabled:scale-95 active:scale-95"
                >
                  {status === "loading" && streamType === "live" ? <AppleSpinner /> : <Tv className="w-4 h-4" />}
                  Fetch Live TV
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleConnect("vod")}
                    disabled={status === "loading"}
                    className="flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-lg font-medium transition-all disabled:opacity-70 disabled:scale-95 active:scale-95 shadow-sm"
                  >
                    {status === "loading" && streamType === "vod" ? <AppleSpinner /> : <Film className="w-4 h-4" />}
                    Movies
                  </button>
                  <button 
                    onClick={() => handleConnect("series")}
                    disabled={status === "loading"}
                    className="flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 py-2.5 px-4 rounded-lg font-medium transition-all disabled:opacity-70 disabled:scale-95 active:scale-95 shadow-sm"
                  >
                    {status === "loading" && streamType === "series" ? <AppleSpinner /> : <Play className="w-4 h-4" />}
                    Series
                  </button>
                </div>
              </div>
              
              {status === "error" && (
                <div className="mt-4 p-3 bg-red-900/20 text-red-400 text-sm rounded-lg flex items-start gap-2 border border-red-900/30">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </div>
              )}
            </div>

            {/* M3U Link Generator */}
            <div className="bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-700/60">
               <h2 className="text-lg font-semibold mb-2 text-white flex items-center gap-2">
                 <Download className="w-5 h-5 text-slate-400" />
                 M3U Playlist
               </h2>
               <p className="text-sm text-slate-400 mb-4">Download full playlist directly.</p>
               <div className="relative">
                 <input 
                   readOnly
                   value={getFullPlaylistUrl()}
                   className="w-full bg-slate-900/50 text-slate-300 text-xs px-3 py-2 pr-10 border border-slate-600 rounded shrink-0 font-mono focus:outline-none"
                 />
                 <button 
                    onClick={() => handleCopy(getFullPlaylistUrl())}
                    className="absolute right-1 top-1 p-1 text-slate-400 hover:text-indigo-400 bg-slate-900/50 rounded"
                    title="Copy M3U Link"
                  >
                   {copiedLink === getFullPlaylistUrl() ? <Check className="w-4 h-4 text-indigo-400" /> : <Copy className="w-4 h-4" />}
                 </button>
               </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col xl:flex-row gap-6 min-w-0">
             {/* Categories sidebar */}
             {status === "connected" && categories.length > 0 && (
                <div className="w-full xl:w-64 flex-shrink-0 bg-slate-800 border border-slate-700/60 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[600px] xl:h-auto xl:max-h-[800px]">
                   <div className="p-4 border-b border-slate-700/60 bg-slate-800/80 font-medium text-slate-200 flex items-center gap-2">
                      <Folder className="w-4 h-4 text-indigo-400" /> Categories
                   </div>
                   <div className="flex-1 overflow-y-auto w-full custom-scrollbar">
                     <button
                        onClick={() => toggleCategory("all")}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors border-b border-slate-700/40 flex items-center gap-3 ${selectedCategories.length === 0 ? "bg-indigo-500/10 text-indigo-300 font-medium border-l-4 border-l-indigo-500" : "text-slate-400 hover:bg-slate-700/30 border-l-4 border-l-transparent"}`}
                     >
                       <input type="checkbox" checked={selectedCategories.length === 0} readOnly className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/50 pointer-events-none" />
                       <span className="truncate">All Categories ({streams.length})</span>
                     </button>
                     {categories.map((cat, idx) => {
                       const count = streams.filter(s => s.category_id == cat.category_id).length;
                       if (count === 0) return null; // Hide empty categories
                       
                       const isSelected = selectedCategories.includes(cat.category_id);
                       
                       return (
                         <button
                            key={cat.category_id || idx}
                            onClick={() => toggleCategory(cat.category_id)}
                            className={`w-full text-left px-4 py-3 text-sm transition-colors border-b border-slate-700/40 flex items-center justify-between gap-2 ${isSelected ? "bg-indigo-500/10 text-indigo-300 font-medium border-l-4 border-l-indigo-500" : "text-slate-400 hover:bg-slate-700/30 border-l-4 border-l-transparent"}`}
                         >
                           <div className="flex items-center gap-3 truncate min-w-0">
                             <input type="checkbox" checked={isSelected} readOnly className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/50 pointer-events-none flex-shrink-0" />
                             <span className="truncate">{cat.category_name}</span>
                           </div>
                           <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full flex-shrink-0">{count}</span>
                         </button>
                       )
                     })}
                   </div>
                </div>
             )}

            {/* Results Area */}
            <div className="flex-1 bg-slate-800 rounded-2xl shadow-sm border border-slate-700/60 min-h-[600px] flex flex-col overflow-hidden">
              {status === "connected" ? (
                <>
                  <div className="p-4 border-b border-slate-700/60 flex flex-col sm:flex-row justify-between items-center gap-4 bg-slate-800 z-10 relative">
                    <div>
                      <h3 className="font-semibold text-lg text-white capitalize">{streamType} Streams</h3>
                      <p className="text-sm text-slate-400">
                        {selectedCategories.length === 0 ? `All categories (${filteredStreams.length} items)` : `${selectedCategories.length} categories selected (${filteredStreams.length} items)`}
                      </p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-72">
                        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input 
                          type="text"
                          placeholder="Search channels..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-slate-900/50 border border-slate-600 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-white placeholder-slate-500"
                        />
                      </div>
                      <button
                        onClick={handleExportM3U}
                        title="Export Custom M3U Playlist"
                        className="flex items-center justify-center p-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors flex-shrink-0 border border-indigo-500 shadow-sm"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        <span className="text-sm font-medium">Export Custom M3U</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto p-4 xl:max-h-[800px] custom-scrollbar">
                    {visibleStreams.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
                        <Search className="w-12 h-12 text-slate-600 mb-3" />
                        <p>No streams found matching your criteria.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {visibleStreams.map((stream, idx) => (
                           <div 
                             key={stream.stream_id || idx} 
                             onClick={() => setPlayingStream(stream)}
                             className="flex flex-col p-4 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-indigo-500/50 hover:shadow-md transition-all group cursor-pointer"
                            >
                             <div className="flex items-start gap-3 mb-3">
                               {stream.stream_icon ? (
                                 <img src={stream.stream_icon} alt={stream.name} loading="lazy" className="w-14 h-14 object-contain bg-slate-900 rounded-lg border border-slate-700 shadow-sm shrink-0" onError={(e) => (e.currentTarget.style.display = 'none')} />
                               ) : (
                                 <div className="w-14 h-14 bg-slate-900 rounded-lg border border-slate-700 shadow-sm flex items-center justify-center shrink-0">
                                   {(streamType === 'vod' || streamType === 'series' || getStreamLink(stream).match(/\.(mkv|mp4|avi|mov|m4v)$/i)) ? <Film className="w-6 h-6 text-slate-600" /> : <Tv className="w-6 h-6 text-slate-600" />}
                                 </div>
                               )}
                               <div className="min-w-0 flex-1">
                                 <h4 className="font-medium text-white truncate leading-tight mb-1" title={stream.name}>{stream.name}</h4>
                                 <div className="flex flex-wrap gap-1">
                                    <span className="text-xs text-slate-400 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded-md self-start">
                                      ID: {stream.stream_id}
                                    </span>
                                    {getStreamLink(stream).match(/\.(mkv|mp4|avi|mov|m4v|ts)$/i) && (
                                      <span className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md self-start">
                                        VOD
                                      </span>
                                    )}
                                    {stream.rating && stream.rating !== 0 && stream.rating !== "0" && (
                                       <span className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md self-start">
                                         ★ {stream.rating}
                                       </span>
                                    )}
                                 </div>
                               </div>
                             </div>

                             <div className="mt-auto relative" onClick={(e) => e.stopPropagation()}>
                               <input 
                                 type="text"
                                 readOnly
                                 onClick={(e) => e.target.select()}
                                 value={getStreamLink(stream)}
                                 className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-md py-2 pl-2 pr-16 text-slate-400 focus:outline-none focus:border-indigo-500 select-all transition-colors cursor-text"
                               />
                               <div className="absolute right-1 top-1 flex items-center gap-0.5">
                                 <button 
                                   onClick={(e) => { e.stopPropagation(); setPlayingStream(stream); }}
                                   className="p-1 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors flex items-center justify-center h-[28px] w-[28px]"
                                   title="Test Play"
                                 >
                                   <Play className="w-3.5 h-3.5" />
                                 </button>
                                 <button 
                                   onClick={() => handleCopy(getStreamLink(stream))}
                                   className="p-1 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded transition-colors flex items-center justify-center h-[28px] w-[28px]"
                                   title="Copy Stream URL"
                                 >
                                   {copiedLink === getStreamLink(stream) ? <Check className="w-4 h-4 text-indigo-400" /> : <Copy className="w-3.5 h-3.5" />}
                                 </button>
                                 <button 
                                   onClick={() => handleDownloadSingleStream(stream)}
                                   className="p-1 text-slate-500 hover:text-green-400 hover:bg-slate-800 rounded transition-colors flex items-center justify-center h-[28px] w-[28px]"
                                   title={(streamType === "vod" || streamType === "series" || getStreamLink(stream).match(/\.(mkv|mp4|avi|mov|m4v|ts)$/i)) ? "Download Media File" : "Save as Playlist (.m3u8)"}
                                 >
                                   <Download className="w-3.5 h-3.5" />
                                 </button>
                               </div>
                             </div>
                           </div>
                        ))}
                      </div>
                    )}
                    
                    {filteredStreams.length > visibleCount && (
                      <div className="mt-10 mb-6 flex flex-col justify-center items-center">
                        <button
                          onClick={() => setVisibleCount(prev => prev + 48)}
                          className="px-8 py-2.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 font-medium rounded-full transition-colors flex items-center gap-2"
                        >
                          Show More
                        </button>
                        <p className="mt-3 text-xs text-slate-500 font-medium uppercase tracking-wider">
                          Showing {visibleCount} of {filteredStreams.length} results
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : status === "loading" ? (
                <div className="flex-1 flex flex-col p-4 bg-slate-800 min-h-[600px] z-10 animate-pulse">
                   <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-700/60">
                     <div className="flex items-center gap-3">
                       <AppleSpinner />
                       <span className="font-semibold text-white tracking-tight text-lg">Loading {streamType}...</span>
                     </div>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                     {[...Array(12)].map((_, i) => (
                       <div key={i} className="flex flex-col p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                         <div className="flex items-start gap-4 mb-4">
                            <div className="w-14 h-14 bg-slate-700 rounded-xl shrink-0"></div>
                            <div className="w-full flex flex-col gap-2.5 pt-1">
                              <div className="h-4 bg-slate-700 rounded-md w-3/4"></div>
                              <div className="h-3 bg-slate-700 rounded-md w-1/3"></div>
                            </div>
                         </div>
                         <div className="mt-auto h-9 bg-slate-700 border border-slate-600 rounded-md w-full"></div>
                       </div>
                     ))}
                   </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 h-full min-h-[400px]">
                  <MonitorPlay className="w-16 h-16 mb-4 text-slate-700" />
                  <h3 className="text-lg font-medium text-slate-400 mb-2">Awaiting Connection</h3>
                  <p className="text-sm max-w-sm text-center">
                    Provide your server details and select a media type to begin loading streams.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        <footer className="mt-12 mb-4 text-center text-slate-500 text-sm">
          <p>
            Follow Nikshep on instagram <a href="https://instagram.com/nikkk.exe" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">@nikkk.exe</a> for movies and live tv visit <a href="https://zestyyflix.vercel.app" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">zestyyflix.vercel.app</a> adfree service by Nikshep!
          </p>
        </footer>
      </div>
    </div>
  );
}

