import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { AlertCircle, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  title: string;
  onPlaybackFailed?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

type StreamKind = 'hls' | 'mpegts';

interface LoadAttempt {
  url: string;
  forceKind: StreamKind;
  disableAudio: boolean;
  label: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, title, onPlaybackFailed, onNext, onPrev, hasNext, hasPrev }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  
  // Custom Controls State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const hlsRef = useRef<Hls | null>(null);
  const playerRef = useRef<mpegts.Player | null>(null);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  const handleMouseLeave = () => {
    setShowControls(false);
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !videoRef.current.muted;
      videoRef.current.muted = newMuted;
      setIsMuted(newMuted);
      if (newMuted) {
        setVolume(0);
      } else {
        setVolume(videoRef.current.volume || 1);
      }
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      const willMute = vol === 0;
      videoRef.current.muted = willMute;
      setIsMuted(willMute);
    }
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen().catch(console.error);
    } else {
      await document.exitFullscreen().catch(console.error);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const updatePlayState = () => setIsPlaying(!video.paused);
    const updateVolumeState = () => {
      setIsMuted(video.muted);
      setVolume(video.volume);
    };
    
    video.addEventListener('play', updatePlayState);
    video.addEventListener('pause', updatePlayState);
    video.addEventListener('volumechange', updateVolumeState);
    
    return () => {
      video.removeEventListener('play', updatePlayState);
      video.removeEventListener('pause', updatePlayState);
      video.removeEventListener('volumechange', updateVolumeState);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let currentMpegtsPlayer: mpegts.Player | null = null;
    let currentHls: Hls | null = null;
    let watchdogTimeout: NodeJS.Timeout | null = null;

    // Reset state
    setError(null);
    setErrorLogs([]);
    setLoading(true);
    setBuffering(false);

    // Build the fallback strategies list using the proxy stream switcher parameters
    const attempts: LoadAttempt[] = [];
    const encodedUrl = encodeURIComponent(url);

    // Strategy 1: Treat as standard HLS playlist wrapper
    attempts.push({ 
      url: `/api/proxy?url=${encodedUrl}`, 
      forceKind: 'hls', 
      disableAudio: false, 
      label: 'Standard HLS Playback Mode' 
    });

    // Strategy 2: Direct Binary Stream Fallback (Forces proxy to bypass text accumulations)
    attempts.push({ 
      url: `/api/proxy?url=${encodedUrl}&type=binary`, 
      forceKind: 'mpegts', 
      disableAudio: false, 
      label: 'MPEG-TS Native Binary Mode' 
    });

    // Strategy 3: Direct Binary Stream Fallback WITHOUT Audio (Bypasses stream sync freezes)
    attempts.push({ 
      url: `/api/proxy?url=${encodedUrl}&type=binary`, 
      forceKind: 'mpegts', 
      disableAudio: true, 
      label: 'MPEG-TS Video-Only Recovery Mode' 
    });

    const clearWatchdog = () => {
      if (watchdogTimeout) {
        clearTimeout(watchdogTimeout);
        watchdogTimeout = null;
      }
    };

    const tryLoad = (attemptIndex: number) => {
      if (!active) return;
      clearWatchdog();

      if (attemptIndex >= attempts.length) {
        setError(`This live channel stream is currently unavailable or offline.`);
        setLoading(false);
        setBuffering(false);
        if (onPlaybackFailed) onPlaybackFailed();
        return;
      }

      const activeAttempt = attempts[attemptIndex];
      const activeUrl = activeAttempt.url;
      const activeKind = activeAttempt.forceKind;
      
      const logMsg = `[Strategy ${attemptIndex + 1}/${attempts.length}] Initializing ${activeAttempt.label}`;
      console.log(`VideoPlayer: ${logMsg}`);
      setErrorLogs(prev => [...prev, logMsg]);

      // Complete cleanup of existing active pipelines
      if (currentMpegtsPlayer) {
        try {
          currentMpegtsPlayer.unload();
          currentMpegtsPlayer.detachMediaElement();
          currentMpegtsPlayer.destroy();
        } catch (e) {}
        currentMpegtsPlayer = null;
        playerRef.current = null;
      }
      if (currentHls) {
        try {
          currentHls.destroy();
        } catch (e) {}
        currentHls = null;
        hlsRef.current = null;
      }

      // Hard reset for the internal browser media pipeline
      try {
        video.pause();
        video.src = '';
        video.removeAttribute('src');
        video.load();
      } catch (e) {}

      setLoading(true);
      setBuffering(false);

      // Watchdog Timer: Force strategy rotation if no video packets clear within 5 seconds
      watchdogTimeout = setTimeout(() => {
        if (!active) return;
        console.warn(`Watchdog timed out on strategy ${attemptIndex + 1}. Transitioning to next strategy...`);
        setErrorLogs(prev => [...prev, `⚠️ Strategy ${attemptIndex + 1} response threshold exceeded`]);
        tryLoad(attemptIndex + 1);
      }, 5000);

      if (activeKind === 'hls') {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: false,
            lowLatencyMode: false,
            manifestLoadingMaxRetry: 1,
            levelLoadingMaxRetry: 1,
            fragLoadingMaxRetry: 1
          });
          currentHls = hls;
          hlsRef.current = hls;

          hls.loadSource(activeUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!active) return;
            video.play().catch(() => {});
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            if (!active) return;
            if (data.fatal) {
              clearWatchdog();
              setTimeout(() => tryLoad(attemptIndex + 1), 16);
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = activeUrl;
          const onLoadedMetadata = () => { if (active) video.play().catch(() => {}); };
          const onNativeError = () => {
            if (!active) return;
            clearWatchdog();
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onNativeError);
            setTimeout(() => tryLoad(attemptIndex + 1), 16);
          };
          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('error', onNativeError);
        } else {
          clearWatchdog();
          tryLoad(attemptIndex + 1);
        }
      } else if (activeKind === 'mpegts') {
        if (mpegts.getFeatureList().mseLivePlayback) {
          try {
            const player = mpegts.createPlayer({
              type: 'mpegts',
              isLive: true,
              url: activeUrl,
              hasAudio: !activeAttempt.disableAudio,
            }, {
              enableWorker: false,
              lazyLoad: false,
              liveBufferLatencyChasing: true,
              liveBufferLatencyMaxLatency: 3.0,
              liveBufferLatencyMinRemaining: 1.0,
              stashInitialSize: 64, 
            });
            
            currentMpegtsPlayer = player;
            playerRef.current = player;
            player.attachMediaElement(video);
            player.load();
            player.play().catch(() => {});
            
            player.on(mpegts.Events.ERROR, () => {
              if (!active) return;
              clearWatchdog();
              setTimeout(() => tryLoad(attemptIndex + 1), 16);
            });
          } catch (err) {
            clearWatchdog();
            tryLoad(attemptIndex + 1);
          }
        } else {
          clearWatchdog();
          tryLoad(attemptIndex + 1);
        }
      }
    };

    // Trigger pipeline processing layout
    tryLoad(0);

    const handleWaiting = () => { if (active) setBuffering(true); };
    const handlePlaying = () => {
      if (!active) return;
      clearWatchdog(); 
      setBuffering(false);
      setLoading(false);
    };

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);

    return () => {
      active = false;
      clearWatchdog();
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      if (currentHls) { try { currentHls.destroy(); } catch (e) {} }
      if (currentMpegtsPlayer) {
        try {
          currentMpegtsPlayer.unload();
          currentMpegtsPlayer.detachMediaElement();
          currentMpegtsPlayer.destroy();
        } catch (e) {}
      }
      try {
        video.src = '';
        video.load();
      } catch (e) {}
    };
  }, [url, onPlaybackFailed]);

  return (
    <div 
      ref={containerRef}
      className={`relative w-full bg-black overflow-hidden group shadow-2xl border border-white/10 ${isFullscreen ? 'h-screen w-screen rounded-none' : 'aspect-video rounded-t-xl'}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleMouseMove}
    >
      {(loading || buffering) && !error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black">
          <div className="text-4xl md:text-7xl font-black italic tracking-tighter text-white shimmer-text animate-pulse select-none">
            ZESTYYSPORTS
          </div>
        </div>
      )}

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#140e0e] z-50 p-6 text-center select-none">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-white font-bold text-lg mb-2 uppercase tracking-wide">Channel Offline</h3>
          <p className="text-gray-400 text-xs max-w-sm mb-4 leading-relaxed">{error}</p>
          
          {errorLogs.length > 0 && (
            <div className="bg-black/60 border border-white/5 text-[10px] text-gray-500 p-3 rounded-lg max-w-sm w-full max-h-24 overflow-y-auto text-left space-y-1 mb-4 font-mono custom-scrollbar">
              {errorLogs.map((log, i) => (
                <div key={i} className="truncate">{log}</div>
              ))}
            </div>
          )}
          
          <div className="flex gap-3">
             {hasPrev && (
               <button 
                 onClick={onPrev}
                 className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold border border-zinc-800 transition-colors flex items-center gap-2"
               >
                 <SkipBack className="w-3.5 h-3.5" />
                 Prev
               </button>
             )}
             <button 
               onClick={() => window.location.reload()}
               className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs tracking-wider uppercase transition-colors"
             >
               Retry Connection
             </button>
             {hasNext && (
               <button 
                 onClick={onNext}
                 className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-semibold border border-zinc-800 transition-colors flex items-center gap-2"
               >
                 Next
                 <SkipForward className="w-3.5 h-3.5" />
               </button>
             )}
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-contain cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
            handleMouseMove();
          }}
          playsInline
        />
      )}
      
      {!loading && !error && (
        <>
          <div className="absolute top-4 right-4 z-40 pointer-events-none opacity-40 text-white font-black tracking-widest text-[9px] sm:text-xs md:text-sm select-none drop-shadow-md">
            zestyysports
          </div>

          <div className={`absolute top-3 left-3 sm:top-4 sm:left-4 z-40 transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
             <div className="px-2.5 py-1 bg-red-600/90 backdrop-blur-md rounded border border-red-500/40 flex items-center gap-1.5 shadow-lg shadow-red-600/20">
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none">LIVE</span>
             </div>
          </div>

          <div className={`absolute bottom-0 left-0 right-0 z-40 transition-opacity duration-500 bg-gradient-to-t from-black/95 via-black/50 to-transparent pt-20 px-3 pb-3 sm:px-4 sm:pb-4 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-white w-full gap-2 sm:gap-4">
                <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                  {hasPrev && (
                    <button onClick={onPrev} className="hover:scale-110 transition-transform p-1">
                      <SkipBack className="w-4 h-4 sm:w-6 sm:h-6 fill-transparent stroke-white" />
                    </button>
                  )}
                  <button onClick={togglePlay} className="hover:scale-110 transition-transform shrink-0 p-1">
                    {isPlaying ? <Pause className="w-4 h-4 sm:w-7 sm:h-7 fill-white" /> : <Play className="w-4 h-4 sm:w-7 sm:h-7 fill-white" />}
                  </button>
                  {hasNext && (
                    <button onClick={onNext} className="hover:scale-110 transition-transform p-1">
                      <SkipForward className="w-4 h-4 sm:w-6 sm:h-6 fill-transparent stroke-white" />
                    </button>
                  )}
                  
                  <div className="group/volume flex items-center gap-1 sm:gap-2 shrink-0">
                    <button onClick={toggleMute} className="hover:scale-110 transition-transform p-1">
                      {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 sm:w-6 sm:h-6" /> : <Volume2 className="w-4 h-4 sm:w-6 sm:h-6" />}
                    </button>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-0 opacity-0 group-hover/volume:w-16 sm:group-hover/volume:w-20 group-hover/volume:opacity-100 transition-all duration-300 accent-red-600 cursor-pointer hidden sm:block"
                    />
                  </div>
                  
                  <h2 className="font-bold text-xs sm:text-sm md:text-base tracking-wide truncate min-w-0 flex-1 ml-1">
                    {title}
                  </h2>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                   <button onClick={toggleFullscreen} className="hover:scale-110 transition-transform p-1">
                     {isFullscreen ? <Minimize className="w-4 h-4 sm:w-6 sm:h-6" /> : <Maximize className="w-4 h-4 sm:w-6 sm:h-6" />}
                   </button>
                </div>
              </div>
              <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden mt-1 cursor-not-allowed">
                 <div className="h-full bg-red-600 w-full rounded-full flex justify-end">
                    <div className="w-1.5 h-full bg-red-400" />
                 </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
