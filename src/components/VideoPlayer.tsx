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

type StreamKind = 'hls' | 'mpegts' | 'native';

function detectKind(url: string): StreamKind {
  const lowercaseUrl = url.toLowerCase();
  if (lowercaseUrl.includes('.m3u8')) return 'hls';
  if (
    lowercaseUrl.includes('.ts') ||
    lowercaseUrl.includes('.mpegts') ||
    lowercaseUrl.includes('.m2ts') ||
    lowercaseUrl.includes('.flv') ||
    (lowercaseUrl.includes('/live/') && !lowercaseUrl.includes('.m3u8')) // Xtream API typical stream URL
  ) {
    return 'mpegts';
  }
  return 'native'; // Default to native for mp4, mkv, webm, avi, etc
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

    // Reset state
    setError(null);
    setErrorLogs([]);
    setLoading(true);
    setBuffering(false);

    const kind = detectKind(url);
    const proxiedUrl = `/api/proxy?url=${encodeURIComponent(url)}`;

    // Generate fallback TS variants if dealing with an Xtream live m3u8 stream
    let fallbackTsUrl = "";
    if (url.includes('/live/') && url.includes('.m3u8')) {
      fallbackTsUrl = url.replace('/live/', '/').replace('.m3u8', '');
    }

    type LoadAttempt = {
      url: string;
      disableAudio?: boolean;
      forceKind?: StreamKind;
    };
    
    const buildAttemptsList = (targetUrl: string, targetKind: StreamKind) => {
      const targetProxiedUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
      const result: LoadAttempt[] = [];
      if (targetUrl.startsWith('https://')) {
        result.push({ url: targetUrl, forceKind: targetKind });
        result.push({ url: targetProxiedUrl, forceKind: targetKind });
      } else {
        result.push({ url: targetProxiedUrl, forceKind: targetKind });
        result.push({ url: targetUrl, forceKind: targetKind });
      }
      return result;
    };

    let attempts: LoadAttempt[] = buildAttemptsList(url, kind);
    
    // If we're a live stream trying HLS, fallback to TS stream on failure
    if (fallbackTsUrl) {
      attempts.push(...buildAttemptsList(fallbackTsUrl, 'mpegts'));
    }

    const tryLoad = (attemptIndex: number) => {
      if (!active) return;

      if (attemptIndex >= attempts.length) {
        setError(`Failed to play stream after exhausting connection attempts.`);
        setLoading(false);
        if (onPlaybackFailed) onPlaybackFailed();
        return;
      }

      const activeAttempt = attempts[attemptIndex];
      const activeUrl = activeAttempt.url;
      const activeKind = activeAttempt.forceKind || kind;
      
      const logMsg = `Attempt ${attemptIndex + 1}/${attempts.length}: Loading ${activeKind} stream`;
      console.log(`VideoPlayer: ${logMsg} with URL: ${activeUrl} (audio: ${!activeAttempt.disableAudio})`);
      setErrorLogs(prev => [...prev, logMsg]);

      // Clean up previous attempts
      if (currentMpegtsPlayer) {
        try {
          currentMpegtsPlayer.unload();
          currentMpegtsPlayer.detachMediaElement();
          currentMpegtsPlayer.destroy();
        } catch (e) {
          console.warn('Error cleaning up previous mpegts player:', e);
        }
        currentMpegtsPlayer = null;
        playerRef.current = null;
      }
      if (currentHls) {
        try {
          currentHls.destroy();
        } catch (e) {
          console.warn('Error cleaning up previous HLS player:', e);
        }
        currentHls = null;
        hlsRef.current = null;
      }

      if (activeKind === 'hls') {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: false, // Disabling worker ensures iframe sandbox compatibility
            lowLatencyMode: false,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 2,
          });
          currentHls = hls;
          hlsRef.current = hls;

          hls.loadSource(activeUrl);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!active) return;
            video.play().catch(() => {});
            setLoading(false);
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            if (!active) return;
            if (data.fatal) {
              const errMsg = `HLS Error: ${data.type} (${data.details})`;
              console.warn(`HLS fatal error: ${data.type} (details: ${data.details}), trying next fallback...`);
              setErrorLogs(prev => [...prev, errMsg]);
              setTimeout(() => tryLoad(attemptIndex + 1), 10);
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native Safari HLS support
          video.src = activeUrl;
          
          const onLoadedMetadata = () => {
            if (!active) return;
            video.play().catch(() => {});
            setLoading(false);
          };

          const onNativeError = () => {
            if (!active) return;
            const errMsg = `Native HLS playback error on attempt ${attemptIndex + 1}`;
            console.warn(`${errMsg}, trying next fallback...`);
            setErrorLogs(prev => [...prev, errMsg]);
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onNativeError);
            setTimeout(() => tryLoad(attemptIndex + 1), 10);
          };

          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('error', onNativeError);
        } else {
          setErrorLogs(prev => [...prev, 'HLS is not supported in this browser.']);
          setError('HLS is not supported in this browser.');
          setLoading(false);
          if (onPlaybackFailed) onPlaybackFailed();
        }
      } else if (activeKind === 'mpegts') {
        if (mpegts.getFeatureList().mseLivePlayback) {
          try {
            const player = mpegts.createPlayer({
              type: url.toLowerCase().includes('.flv') ? 'flv' : 'mpegts',
              isLive: true,
              url: activeUrl,
              hasAudio: !activeAttempt.disableAudio,
            }, {
              enableWorker: false, // Disabling worker is essential inside sandbox iframes
              lazyLoad: false,
              liveBufferLatencyChasing: false,
              stashInitialSize: 128,
            });
            currentMpegtsPlayer = player;
            playerRef.current = player;
            player.attachMediaElement(video);
            player.load();
            
            const playPromise = player.play() as any;
            if (playPromise && playPromise.catch) {
              playPromise.catch(() => {});
            }
            setLoading(false);
            
            player.on(mpegts.Events.ERROR, (type, detail) => {
              if (!active) return;
              const errMsg = `MPEG-TS Player Error: type=${type}, detail=${detail}`;
              console.warn(`${errMsg} on attempt ${attemptIndex + 1}. Trying next fallback...`);
              setErrorLogs(prev => [...prev, errMsg]);
              setTimeout(() => tryLoad(attemptIndex + 1), 10);
            });
          } catch (err: any) {
            console.error('Failed to create MPEG-TS player:', err);
            setErrorLogs(prev => [...prev, `Failed to create MPEG-TS player: ${err.message || 'Unknown'}`]);
            tryLoad(attemptIndex + 1);
          }
        } else {
          setErrorLogs(prev => [...prev, 'MPEG-TS/FLV playback is not supported in this browser.']);
          setError('MPEG-TS/FLV playback is not supported in this browser.');
          setLoading(false);
          if (onPlaybackFailed) onPlaybackFailed();
        }
      } else {
        // Native
        video.src = activeUrl;

        const onLoaded = () => {
          if (!active) return;
          video.play().catch(() => {});
          setLoading(false);
        };

        const onNativeError = () => {
          if (!active) return;
          const errMsg = `Native playback error on attempt ${attemptIndex + 1}`;
          console.warn(`${errMsg}. Trying next fallback...`);
          setErrorLogs(prev => [...prev, errMsg]);
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onNativeError);
          setTimeout(() => tryLoad(attemptIndex + 1), 10);
        };

        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onNativeError);
      }
    };

    // Begin Loading
    tryLoad(0);

    const handleWaiting = () => setBuffering(true);
    const handlePlaying = () => setBuffering(false);

    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);

    return () => {
      active = false;
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      if (currentHls) {
        try {
          currentHls.destroy();
        } catch (e) {}
      }
      if (currentMpegtsPlayer) {
        try {
          currentMpegtsPlayer.unload();
          currentMpegtsPlayer.detachMediaElement();
          currentMpegtsPlayer.destroy();
        } catch (e) {}
      }
      if (video) {
        try {
          video.src = '';
          video.load();
        } catch (e) {}
      }
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
          <div className="text-4xl md:text-7xl font-black italic tracking-tighter text-white shimmer-text animate-pulse">
            ZESTYYSPORTS
          </div>
        </div>
      )}

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1313] z-50 p-6 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-white font-semibold text-lg mb-2">Playback Error</h3>
          <p className="text-red-400/80 text-sm max-w-md mb-3">{error}</p>
          
          {errorLogs.length > 0 && (
            <div className="bg-black/50 border border-red-500/20 text-xs text-red-300 p-2.5 rounded max-w-md w-full max-h-32 overflow-y-auto text-left space-y-1 mb-4 font-mono custom-scrollbar">
              {errorLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
          
          <div className="flex gap-3">
             {hasPrev && (
               <button 
                 onClick={onPrev}
                 className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm border border-slate-600 transition-colors flex items-center gap-2"
               >
                 <SkipBack className="w-4 h-4" />
                 Prev
               </button>
             )}
             <button 
               onClick={() => window.location.reload()}
               className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm border border-red-500/30 transition-colors"
             >
               Refresh Player
             </button>
             {hasNext && (
               <button 
                 onClick={onNext}
                 className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm border border-slate-600 transition-colors flex items-center gap-2"
               >
                 Next
                 <SkipForward className="w-4 h-4" />
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

          {/* Top Left Live Badge */}
          <div className={`absolute top-3 left-3 sm:top-4 sm:left-4 z-40 transition-opacity duration-300 ${showControls || !isPlaying ? 'opacity-100' : 'opacity-0'}`}>
             <div className="px-2.5 py-1 bg-red-600/90 backdrop-blur-md rounded border border-red-500/40 flex items-center gap-1.5 shadow-lg shadow-red-600/20">
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span className="text-[10px] font-black text-white uppercase tracking-widest leading-none">LIVE</span>
             </div>
          </div>

          {/* Bottom Controls Gradient & Bar */}
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
