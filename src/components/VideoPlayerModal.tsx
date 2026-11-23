import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Clock,
  CreditCard,
  Film,
  Gauge,
  ListVideo,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { mapRemoteKeyEvent } from '../platform/deviceAdapter';
import {
  PlaybackAuthError,
  authorizePlayback,
  probeMediaStream,
  saveWatchProgress,
  sendPlaybackHeartbeat,
  stopPlaybackSession,
} from '../services/playbackService';
import type {
  Episode,
  PlaybackAuthorizeResult,
  Season,
  WatchHistoryItem,
} from '../types/domain';
import { formatTrialTime } from '../utils/formatters';

export interface PlayerMediaTarget {
  mediaType: 'movie' | 'episode' | 'trailer';
  mediaId: string;
  seriesId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  title: string;
  subtitle?: string;
  posterUrl: string;
  initialProgressSeconds?: number;
}

interface VideoPlayerModalProps {
  uid: string;
  target: PlayerMediaTarget;
  nextEpisodeTarget?: PlayerMediaTarget | null;
  seasons?: Season[];
  episodes?: Episode[];
  historyByMediaId?: Map<string, WatchHistoryItem>;
  onPlayEpisode?: (episode: Episode) => void;
  onSelectTarget: (next: PlayerMediaTarget) => void;
  onOpenPlans: () => void;
  onClose: () => void;
}

function formatVideoClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const EMPTY_SEASONS: Season[] = [];
const EMPTY_EPISODES: Episode[] = [];

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  uid,
  target,
  nextEpisodeTarget,
  seasons = EMPTY_SEASONS,
  episodes = EMPTY_EPISODES,
  historyByMediaId,
  onPlayEpisode,
  onSelectTarget,
  onOpenPlans,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string>('');
  const isPlayingRef = useRef<boolean>(false);
  const hideControlsTimerRef = useRef<number | null>(null);
  const lastHistorySaveRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [authData, setAuthData] = useState<PlaybackAuthorizeResult | null>(null);
  const [errorState, setErrorState] = useState<{
    code: string;
    message: string;
    isPaywall: boolean;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [episodesDrawerOpen, setEpisodesDrawerOpen] = useState(false);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(
    target.seasonNumber || 1
  );

  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  const [accessMode, setAccessMode] = useState<'active' | 'trial' | 'admin' | 'trailer'>('active');
  const [nextEpCountdown, setNextEpCountdown] = useState<number | null>(null);

  const isSeriesPlayback = target.mediaType === 'episode';

  const targetRef = useRef(target);
  targetRef.current = target;
  const episodesDrawerOpenRef = useRef(episodesDrawerOpen);
  episodesDrawerOpenRef.current = episodesDrawerOpen;
  const speedPopoverOpenRef = useRef(speedPopoverOpen);
  speedPopoverOpenRef.current = speedPopoverOpen;

  const persistProgressNow = useCallback(
    (force = false) => {
      const t = targetRef.current;
      if (t.mediaType === 'trailer') return;
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.currentTime)) return;
      const now = Date.now();
      if (!force && now - lastHistorySaveRef.current < 10_000) return;
      lastHistorySaveRef.current = now;

      void saveWatchProgress({
        uid,
        mediaType: t.mediaType,
        mediaId: t.mediaId,
        seriesId: t.seriesId ?? null,
        seasonNumber: t.seasonNumber ?? null,
        episodeNumber: t.episodeNumber ?? null,
        title: t.subtitle ? `${t.title} · ${t.subtitle}` : t.title,
        posterUrl: t.posterUrl,
        progressSeconds: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
      });
    },
    [uid]
  );

  const scheduleAutoHide = useCallback(() => {
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    if (
      isPlayingRef.current &&
      !episodesDrawerOpenRef.current &&
      !speedPopoverOpenRef.current
    ) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 3500);
    }
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  const hideControlsNow = useCallback(() => {
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    setControlsVisible(false);
  }, []);

  const availableSeasons = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of seasons) {
      map.set(s.seasonNumber, s.title || `Temporada ${s.seasonNumber}`);
    }
    for (const ep of episodes) {
      if (!map.has(ep.seasonNumber)) {
        map.set(ep.seasonNumber, `Temporada ${ep.seasonNumber}`);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([seasonNumber, title]) => ({ seasonNumber, title }));
  }, [seasons, episodes]);

  const episodesInSelectedSeason = useMemo(() => {
    const filtered = episodes.filter((ep) => ep.seasonNumber === selectedSeasonNumber);
    if (filtered.length > 0 || availableSeasons.length > 0) {
      return filtered;
    }
    return episodes;
  }, [availableSeasons.length, episodes, selectedSeasonNumber]);

  useEffect(() => {
    setEpisodesDrawerOpen(false);
    setSpeedPopoverOpen(false);
  }, [target.mediaId]);

  useEffect(() => {
    setSelectedSeasonNumber(target.seasonNumber || availableSeasons[0]?.seasonNumber || 1);
  }, [target.mediaId, target.seasonNumber, availableSeasons]);

  useEffect(() => {
    if (episodesDrawerOpen || speedPopoverOpen) {
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
      setControlsVisible(true);
    } else {
      scheduleAutoHide();
    }
  }, [episodesDrawerOpen, speedPopoverOpen, scheduleAutoHide]);

  // Authorize playback & probe source source on target change
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      setErrorState(null);
      setAuthData(null);
      setIsPlaying(false);
      isPlayingRef.current = false;
      setControlsVisible(false);
      setEpisodesDrawerOpen(false);
      setSpeedPopoverOpen(false);
      setNextEpCountdown(null);
      setCurrentTime(0);
      setDuration(0);

      try {
        const res = await authorizePlayback(target.mediaId, target.mediaType);
        if (cancelled) {
          void stopPlaybackSession(res.sessionId);
          return;
        }

        if (res.provider !== 'youtube' && res.streamUrl) {
          const probe = await probeMediaStream(res.streamUrl);
          if (cancelled) {
            void stopPlaybackSession(res.sessionId);
            return;
          }

          if (!probe.ok) {
            void stopPlaybackSession(res.sessionId);
            setErrorState({
              code: probe.errorCode || 'STREAM_ERROR',
              message: probe.message || 'Falha ao carregar o arquivo de vídeo.',
              isPaywall: false,
            });
            setLoading(false);
            return;
          }
        }

        sessionIdRef.current = res.sessionId;
        setAuthData(res);
        setAccessMode(res.accessMode);
        setTrialRemaining(res.accessMode === 'trial' ? res.trialSecondsRemaining : null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const code = err instanceof PlaybackAuthError ? err.code : 'PLAYBACK_ERROR';
        const message =
          err instanceof Error ? err.message : 'Não foi possível iniciar a reprodução.';
        const isPaywall =
          code === 'TRIAL_EXPIRED' ||
          code === 'SUBSCRIPTION_EXPIRED' ||
          code === 'TRIAL_OR_SUB_EXPIRED' ||
          code === 'ACCOUNT_FROZEN' ||
          code === 'ACCOUNT_BLOCKED';
        setErrorState({ code, message, isPaywall });
        setLoading(false);
      }
    };

    void init();

    return () => {
      cancelled = true;
      persistProgressNow(true);
      if (sessionIdRef.current) {
        void stopPlaybackSession(sessionIdRef.current);
        sessionIdRef.current = '';
      }
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [target.mediaId, target.mediaType, persistProgressNow]);

  // Server-validated heartbeat loop (only increments trial time while playing)
  useEffect(() => {
    if (!authData?.sessionId) return;

    const interval = window.setInterval(async () => {
      if (!sessionIdRef.current || !isPlayingRef.current) return;
      const hb = await sendPlaybackHeartbeat(sessionIdRef.current, 'playing');
      if (!hb.allowed) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        videoRef.current?.pause();
        setAuthData(null);
        setErrorState({
          code: hb.reason || 'TRIAL_EXPIRED',
          message:
            hb.reason === 'ACCOUNT_BLOCKED'
              ? 'Sua conta foi bloqueada pela administração.'
              : hb.reason === 'ACCOUNT_FROZEN'
                ? 'Sua assinatura foi congelada pela administração.'
                : 'Seus minutos de teste gratuito chegaram ao fim. Escolha um plano para continuar assistindo sem limites.',
          isPaywall: true,
        });
        return;
      }
      if (hb.accessMode === 'trial' && typeof hb.trialSecondsRemaining === 'number') {
        setTrialRemaining(hb.trialSecondsRemaining);
      }
      if (hb.accessMode) {
        setAccessMode(hb.accessMode);
      }
    }, 4500);

    return () => window.clearInterval(interval);
  }, [authData?.sessionId]);

  // Smooth local HUD countdown ONLY while actually playing (not paused/buffering)
  useEffect(() => {
    if (accessMode !== 'trial' || !isPlaying || isBuffering) return;
    const ticker = window.setInterval(() => {
      setTrialRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [accessMode, isPlaying, isBuffering]);

  // Next-episode countdown when episode finishes
  useEffect(() => {
    if (nextEpCountdown === null || !nextEpisodeTarget) return;
    if (nextEpCountdown <= 0) {
      onSelectTarget(nextEpisodeTarget);
      return;
    }
    const timer = window.setTimeout(() => {
      setNextEpCountdown((c) => (c !== null ? c - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [nextEpCountdown, nextEpisodeTarget, onSelectTarget]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play();
      hideControlsNow();
    } else {
      video.pause();
      setControlsVisible(true);
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    }
  }, [hideControlsNow]);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const targetTime = Math.max(
        0,
        Math.min(video.duration || 0, video.currentTime + deltaSeconds)
      );
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      revealControls();
    },
    [revealControls]
  );

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Fullscreen may be restricted in some embedded contexts
    }
  }, []);

  // Keyboard & Smart TV remote navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const remoteKey = mapRemoteKeyEvent(e);
      if (remoteKey === 'BACK') {
        e.preventDefault();
        if (speedPopoverOpenRef.current) {
          setSpeedPopoverOpen(false);
          return;
        }
        if (episodesDrawerOpenRef.current) {
          setEpisodesDrawerOpen(false);
          return;
        }
        persistProgressNow(true);
        onClose();
        return;
      }
      if (remoteKey === 'PLAY_PAUSE' || e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlayPause();
        return;
      }
      if (remoteKey === 'LEFT') {
        e.preventDefault();
        seekBy(-10);
        return;
      }
      if (remoteKey === 'RIGHT') {
        e.preventDefault();
        seekBy(10);
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setIsMuted((prev) => {
          const next = !prev;
          if (videoRef.current) videoRef.current.muted = next;
          return next;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, persistProgressNow, seekBy, toggleFullscreen, togglePlayPause]);

  // Subtitle track visibility sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      video.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, authData]);

  // Playback speed sync
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, authData]);

  const handleClose = () => {
    persistProgressNow(true);
    if (sessionIdRef.current) {
      void stopPlaybackSession(sessionIdRef.current);
      sessionIdRef.current = '';
    }
    onClose();
  };

  const showOverlayControls =
    authData?.provider === 'youtube' ? true : controlsVisible || !isPlaying;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 bg-[#050608] text-white flex flex-col select-none"
    >
      {/* Top Overlay Header */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-0 inset-x-0 z-20 p-5 sm:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent flex items-center justify-between gap-4 transition-opacity duration-200 ${
          showOverlayControls || loading || errorState
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            type="button"
            data-tv-focusable="true"
            onClick={handleClose}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar</span>
          </button>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-semibold text-white truncate">
              {target.title}
            </h2>
            {target.subtitle && (
              <p className="text-xs text-neutral-300 truncate">{target.subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {authData?.qualityLabel && (
            <span className="px-2.5 py-1 rounded border border-white/15 bg-black/50 font-mono text-xs text-neutral-200">
              {authData.qualityLabel}
            </span>
          )}
          {accessMode === 'trial' && trialRemaining !== null && (
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111318]/90 border border-[#E11D48]/40 text-xs font-mono tabular-nums"
              title="O contador só avança enquanto o vídeo está reproduzindo"
            >
              <Clock className="w-3.5 h-3.5 text-[#FB7185]" />
              <span className="text-neutral-300">Teste:</span>
              <span className="text-white font-semibold">{formatTrialTime(trialRemaining)}</span>
              {!isPlaying && <span className="text-neutral-400">(pausado)</span>}
            </div>
          )}
        </div>
      </div>

      {/* Main Video Surface */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <Loader2 className="w-9 h-9 text-[#E11D48] animate-spin" />
            <p className="text-sm text-neutral-300">Preparando transmissão segura...</p>
          </div>
        )}

        {!loading && errorState && (
          <div className="max-w-lg mx-auto p-8 rounded-xl bg-[#111318] border border-white/10 text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-[#E11D48]/15 border border-[#E11D48]/30 flex items-center justify-center mx-auto">
              {errorState.isPaywall ? (
                <CreditCard className="w-6 h-6 text-[#FB7185]" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-[#FB7185]" />
              )}
            </div>
            <div className="space-y-2">
              <h3 className="font-display text-xl font-semibold text-white">
                {errorState.isPaywall
                  ? 'Assinatura necessária para continuar'
                  : 'Não foi possível reproduzir este vídeo'}
              </h3>
              <p className="text-sm text-neutral-300 leading-relaxed">{errorState.message}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              {errorState.isPaywall && (
                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={() => {
                    handleClose();
                    onOpenPlans();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-xs font-medium text-white transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Ver Planos Disponíveis</span>
                </button>
              )}
              <button
                type="button"
                data-tv-focusable="true"
                onClick={handleClose}
                className="px-4 py-2.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-medium text-neutral-200 transition-colors"
              >
                Voltar ao catálogo
              </button>
            </div>
          </div>
        )}

        {!loading && !errorState && authData && authData.provider === 'youtube' && authData.embedUrl && (
          <div className="w-full h-full flex items-center justify-center p-4 sm:p-12 pt-20">
            <div className="w-full max-w-5xl aspect-video rounded-xl overflow-hidden border border-white/15 bg-black shadow-2xl">
              <iframe
                src={authData.embedUrl}
                title={`Trailer — ${target.title}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}

        {!loading && !errorState && authData && authData.provider !== 'youtube' && (
          <>
            <video
              ref={videoRef}
              src={authData.streamUrl}
              poster={target.posterUrl || undefined}
              playsInline
              autoPlay
              preload="metadata"
              onClick={(e) => {
                e.stopPropagation();
                if (episodesDrawerOpen || speedPopoverOpen) {
                  setEpisodesDrawerOpen(false);
                  setSpeedPopoverOpen(false);
                  return;
                }
                if (!controlsVisible) {
                  revealControls();
                } else if (isPlaying) {
                  hideControlsNow();
                }
              }}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (!video) return;
                video.playbackRate = playbackRate;
                const dur = Number.isFinite(video.duration) ? video.duration : 0;
                setDuration(dur);
                if (
                  target.initialProgressSeconds &&
                  target.initialProgressSeconds > 5 &&
                  dur > 20 &&
                  target.initialProgressSeconds < dur - 10
                ) {
                  video.currentTime = target.initialProgressSeconds;
                  setCurrentTime(target.initialProgressSeconds);
                }
              }}
              onPlay={() => {
                isPlayingRef.current = true;
                setIsPlaying(true);
                setIsBuffering(false);
                setNextEpCountdown(null);
              }}
              onPause={() => {
                isPlayingRef.current = false;
                setIsPlaying(false);
                setControlsVisible(true);
                if (hideControlsTimerRef.current) {
                  window.clearTimeout(hideControlsTimerRef.current);
                }
                persistProgressNow(true);
                if (sessionIdRef.current) {
                  void sendPlaybackHeartbeat(sessionIdRef.current, 'paused');
                }
              }}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => {
                isPlayingRef.current = true;
                setIsPlaying(true);
                setIsBuffering(false);
              }}
              onTimeUpdate={() => {
                const video = videoRef.current;
                if (!video) return;
                setCurrentTime(video.currentTime);
                if (Number.isFinite(video.duration)) setDuration(video.duration);
                persistProgressNow(false);
              }}
              onEnded={() => {
                isPlayingRef.current = false;
                setIsPlaying(false);
                persistProgressNow(true);
                if (sessionIdRef.current) {
                  void sendPlaybackHeartbeat(sessionIdRef.current, 'paused');
                }
                if (nextEpisodeTarget) {
                  setNextEpCountdown(8);
                }
              }}
              onError={() => {
                isPlayingRef.current = false;
                setIsPlaying(false);
                const mediaErr = videoRef.current?.error;
                const detail = mediaErr
                  ? ` (código ${mediaErr.code}${mediaErr.message ? `: ${mediaErr.message}` : ''})`
                  : '';
                const streamUrl = authData.streamUrl;
                void (async () => {
                  let httpNote = '';
                  try {
                    const check = await fetch(streamUrl, {
                      headers: { Range: 'bytes=0-63' },
                    });
                    const ct = check.headers.get('content-type') || 'desconhecido';
                    const cr = check.headers.get('content-range') || 'sem range';
                    httpNote = ` [HTTP ${check.status} · ${ct} · ${cr}]`;
                  } catch {
                    // ignore diagnostic fetch error
                  }
                  setErrorState({
                    code: 'VIDEO_ELEMENT_ERROR',
                    message: `O navegador não conseguiu decodificar ou carregar o vídeo${detail}${httpNote}. Verifique se o arquivo no Google Drive está em formato MP4 (H.264/AAC) ou WebM compatível.`,
                    isPaywall: false,
                  });
                })();
              }}
              className="w-full h-full max-h-screen object-contain bg-black"
            >
              {authData.subtitleUrl && (
                <track
                  kind="subtitles"
                  src={authData.subtitleUrl}
                  srcLang="pt"
                  label="Português"
                  default
                />
              )}
            </video>

            {/* Netflix-style Center Overlay: -10s / Play-Pause / +10s (hidden until clicked/tapped) */}
            <div
              onClick={() => {
                if (episodesDrawerOpen || speedPopoverOpen) {
                  setEpisodesDrawerOpen(false);
                  setSpeedPopoverOpen(false);
                  return;
                }
                if (!controlsVisible) {
                  revealControls();
                } else if (isPlaying) {
                  hideControlsNow();
                }
              }}
              className={`absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-200 ${
                controlsVisible || !isPlaying
                  ? 'opacity-100 bg-black/35'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center gap-7 sm:gap-14"
              >
                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={() => seekBy(-10)}
                  aria-label="Voltar 10 segundos"
                  title="Voltar 10 segundos"
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 hover:bg-black/80 border border-white/20 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95"
                >
                  <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
                  <span className="font-mono text-[10px] font-bold leading-none tabular-nums">
                    -10s
                  </span>
                </button>

                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#E11D48] hover:bg-[#BE123C] text-white shadow-2xl flex items-center justify-center transition-transform active:scale-95"
                >
                  {isPlaying ? (
                    <Pause className="w-7 h-7 sm:w-8 sm:h-8 fill-current" />
                  ) : (
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current ml-1" />
                  )}
                </button>

                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={() => seekBy(10)}
                  aria-label="Avançar 10 segundos"
                  title="Avançar 10 segundos"
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 hover:bg-black/80 border border-white/20 backdrop-blur-sm text-white flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95"
                >
                  <RotateCw className="w-5 h-5 sm:w-6 sm:h-6" />
                  <span className="font-mono text-[10px] font-bold leading-none tabular-nums">
                    +10s
                  </span>
                </button>
              </div>
            </div>

            {isBuffering && !controlsVisible && isPlaying && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-white animate-spin drop-shadow" />
              </div>
            )}

            {nextEpCountdown !== null && nextEpisodeTarget && (
              <div className="absolute right-6 bottom-28 z-30 p-5 rounded-xl bg-[#111318]/95 border border-white/15 max-w-xs space-y-3 shadow-2xl">
                <p className="text-xs text-[#FB7185] font-medium">
                  Próximo episódio em {nextEpCountdown}s
                </p>
                <p className="text-sm font-medium text-white line-clamp-2">
                  {nextEpisodeTarget.subtitle || nextEpisodeTarget.title}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-tv-focusable="true"
                    onClick={() => onSelectTarget(nextEpisodeTarget)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-xs font-medium text-white"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Reproduzir agora</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNextEpCountdown(null)}
                    className="px-3 py-2 rounded-lg border border-white/15 text-xs text-neutral-300 hover:text-white"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            {isSeriesPlayback && episodesDrawerOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-4 sm:right-6 bottom-28 sm:bottom-24 z-30 w-[calc(100%-2rem)] sm:w-[440px] max-h-[60vh] flex flex-col rounded-xl bg-[#0B0D12]/95 backdrop-blur-md border border-white/12 shadow-2xl overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-sm font-semibold text-white truncate">
                      Episódios
                    </h3>
                    <p className="text-xs text-neutral-400 truncate">{target.title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEpisodesDrawerOpen(false)}
                    aria-label="Fechar lista de episódios"
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {availableSeasons.length > 1 && (
                  <div className="px-4 py-2.5 border-b border-white/8 flex items-center gap-1.5 overflow-x-auto">
                    {availableSeasons.map((season) => (
                      <button
                        key={season.seasonNumber}
                        type="button"
                        onClick={() => setSelectedSeasonNumber(season.seasonNumber)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                          selectedSeasonNumber === season.seasonNumber
                            ? 'bg-[#E11D48] text-white'
                            : 'bg-white/5 text-neutral-300 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {season.title}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-white/8">
                  {episodesInSelectedSeason.length === 0 ? (
                    <p className="p-5 text-xs text-neutral-400">
                      Nenhum episódio disponível para esta série no momento.
                    </p>
                  ) : (
                    episodesInSelectedSeason.map((ep) => {
                      const isCurrent = ep.id === target.mediaId;
                      const epHist = historyByMediaId?.get(ep.id);
                      const epPct =
                        epHist && epHist.durationSeconds > 0
                          ? Math.min(
                              100,
                              Math.round((epHist.progressSeconds / epHist.durationSeconds) * 100)
                            )
                          : 0;

                      return (
                        <button
                          key={ep.id}
                          type="button"
                          disabled={!ep.hasVideoSource || isCurrent}
                          onClick={() => {
                            if (!ep.hasVideoSource || isCurrent) return;
                            setEpisodesDrawerOpen(false);
                            if (onPlayEpisode) {
                              onPlayEpisode(ep);
                            }
                          }}
                          className={`w-full p-3.5 flex items-center gap-3 text-left transition-colors ${
                            isCurrent
                              ? 'bg-[#E11D48]/12 cursor-default'
                              : ep.hasVideoSource
                                ? 'hover:bg-white/[0.05] cursor-pointer'
                                : 'opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="w-24 aspect-video rounded-md overflow-hidden bg-[#14171F] border border-white/10 shrink-0 relative flex items-center justify-center">
                            {ep.thumbnailUrl ? (
                              <img
                                src={ep.thumbnailUrl}
                                alt={ep.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Film className="w-4 h-4 text-neutral-500" />
                            )}
                            {epPct > 0 && (
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                                <div
                                  className="h-full bg-[#E11D48]"
                                  style={{ width: `${epPct}%` }}
                                />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-white truncate">
                                {ep.episodeNumber}. {ep.title}
                              </p>
                              <span className="font-mono text-[11px] text-neutral-400 tabular-nums shrink-0">
                                {ep.durationMinutes} min
                              </span>
                            </div>
                            {ep.description && (
                              <p className="text-[11px] text-neutral-400 line-clamp-2 leading-snug">
                                {ep.description}
                              </p>
                            )}
                            <p className="text-[11px] font-medium">
                              {isCurrent ? (
                                <span className="text-[#FB7185]">Reproduzindo agora</span>
                              ) : ep.hasVideoSource ? (
                                <span className="text-neutral-400">
                                  T{ep.seasonNumber} · E{ep.episodeNumber}
                                </span>
                              ) : (
                                <span className="text-neutral-500">Sem vídeo vinculado</span>
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Playback Controls */}
      {!loading && !errorState && authData && authData.provider !== 'youtube' && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (speedPopoverOpen) {
              setSpeedPopoverOpen(false);
            }
            revealControls();
          }}
          className={`absolute bottom-0 inset-x-0 z-20 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/75 to-transparent space-y-3 transition-opacity duration-200 ${
            controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Scrubber Bar */}
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-neutral-300 tabular-nums w-12 sm:w-14 text-right">
              {formatVideoClock(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.5}
              value={duration > 0 ? currentTime : 0}
              onChange={(e) => {
                const nextTime = Number(e.target.value);
                if (videoRef.current) {
                  videoRef.current.currentTime = nextTime;
                }
                setCurrentTime(nextTime);
                revealControls();
              }}
              aria-label="Progresso do vídeo"
              className="flex-1 h-1.5 accent-[#E11D48] cursor-pointer bg-white/20 rounded-lg"
            />
            <span className="font-mono text-xs text-neutral-400 tabular-nums w-12 sm:w-14">
              {formatVideoClock(duration)}
            </span>
          </div>

          {/* Bottom Bar: Left (Volume) — Center (Velocidade) — Right (Série / Legendas / Tela Cheia) */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {/* Left Zone: Volume */}
            <div className="justify-self-start flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  if (videoRef.current) videoRef.current.muted = nextMuted;
                  revealControls();
                }}
                aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                className="min-w-[40px] min-h-[40px] p-2 rounded-lg hover:bg-white/10 text-neutral-200 flex items-center justify-center transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setIsMuted(v === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = v;
                    videoRef.current.muted = v === 0;
                  }
                  revealControls();
                }}
                aria-label="Volume"
                className="hidden sm:block w-24 h-1 accent-white cursor-pointer"
              />
            </div>

            {/* Center Zone: "Velocidade" trigger + centered sliding popover */}
            <div className="justify-self-center relative">
              {speedPopoverOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-30 w-64 sm:w-80 p-4 rounded-xl bg-[#0B0D12]/95 backdrop-blur-md border border-white/15 shadow-2xl space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-neutral-300">Velocidade</span>
                    <span className="font-mono text-xs font-semibold text-white tabular-nums">
                      {playbackRate === 1 ? '1x' : `${playbackRate}x`}
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0.5}
                    max={1.5}
                    step={0.25}
                    value={playbackRate}
                    onChange={(e) => {
                      const nextRate = Math.max(
                        0.5,
                        Math.min(1.5, Number(e.target.value))
                      );
                      setPlaybackRate(nextRate);
                      if (videoRef.current) {
                        videoRef.current.playbackRate = nextRate;
                      }
                      revealControls();
                    }}
                    aria-label="Barra deslizante de velocidade de reprodução"
                    className="w-full h-2 accent-[#E11D48] cursor-grab active:cursor-grabbing bg-white/20 rounded-lg touch-pan-x"
                  />

                  <div
                    aria-hidden="true"
                    className="flex items-center justify-between text-[11px] font-mono text-neutral-400 tabular-nums select-none pointer-events-none px-0.5"
                  >
                    <span>0.5x</span>
                    <span>0.75x</span>
                    <span>1x</span>
                    <span>1.25x</span>
                    <span>1.5x</span>
                  </div>
                </div>
              )}

              <button
                type="button"
                data-tv-focusable="true"
                onClick={(e) => {
                  e.stopPropagation();
                  setEpisodesDrawerOpen(false);
                  episodesDrawerOpenRef.current = false;
                  setSpeedPopoverOpen((prev) => {
                    const next = !prev;
                    speedPopoverOpenRef.current = next;
                    return next;
                  });
                  setControlsVisible(true);
                }}
                aria-label="Velocidade"
                aria-expanded={speedPopoverOpen}
                className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  speedPopoverOpen
                    ? 'border-[#E11D48] bg-[#E11D48]/20 text-white'
                    : 'border-white/15 bg-white/5 hover:bg-white/15 text-white'
                }`}
              >
                <Gauge className="w-4 h-4 text-[#FB7185] shrink-0" />
                <span>Velocidade</span>
              </button>
            </div>

            {/* Right Zone: Series controls (only for series) + Subtitles + Fullscreen */}
            <div className="justify-self-end flex items-center justify-end gap-1.5 sm:gap-2 min-w-0">
              {isSeriesPlayback && (
                <>
                  <button
                    type="button"
                    data-tv-focusable="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSpeedPopoverOpen(false);
                      speedPopoverOpenRef.current = false;
                      setEpisodesDrawerOpen((prev) => {
                        const next = !prev;
                        episodesDrawerOpenRef.current = next;
                        return next;
                      });
                      setControlsVisible(true);
                    }}
                    aria-label="Ver episódios"
                    aria-expanded={episodesDrawerOpen}
                    title="Ver episódios"
                    className={`min-w-[40px] min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      episodesDrawerOpen
                        ? 'border-[#E11D48] bg-[#E11D48]/20 text-white'
                        : 'border-white/15 bg-white/5 hover:bg-white/15 text-white'
                    }`}
                  >
                    <ListVideo className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">Episódios</span>
                  </button>

                  <button
                    type="button"
                    data-tv-focusable="true"
                    disabled={!nextEpisodeTarget}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!nextEpisodeTarget) return;
                      setEpisodesDrawerOpen(false);
                      setSpeedPopoverOpen(false);
                      onSelectTarget(nextEpisodeTarget);
                    }}
                    aria-label="Pular para o próximo episódio"
                    title={
                      nextEpisodeTarget
                        ? `Próximo episódio: ${nextEpisodeTarget.subtitle || nextEpisodeTarget.title}`
                        : 'Você está no último episódio disponível'
                    }
                    className={`min-w-[40px] min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      nextEpisodeTarget
                        ? 'border-white/15 bg-white/10 hover:bg-white/20 text-white'
                        : 'border-white/10 bg-white/5 text-neutral-500 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <SkipForward className="w-4 h-4 shrink-0" />
                    <span className="hidden lg:inline">Próximo episódio</span>
                    <span className="hidden sm:inline lg:hidden">Próximo</span>
                  </button>
                </>
              )}

              {authData.subtitleUrl && (
                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubtitlesEnabled((s) => !s);
                  }}
                  title="Alternar legendas"
                  className={`min-w-[40px] min-h-[40px] p-2 rounded-lg border flex items-center justify-center transition-colors ${
                    subtitlesEnabled
                      ? 'border-[#E11D48] bg-[#E11D48]/20 text-white'
                      : 'border-white/15 text-neutral-400 hover:text-white'
                  }`}
                >
                  <Captions className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                data-tv-focusable="true"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleFullscreen();
                }}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                className="min-w-[40px] min-h-[40px] p-2 rounded-lg hover:bg-white/10 text-neutral-200 flex items-center justify-center transition-colors"
              >
                {isFullscreen ? (
                  <Minimize className="w-4 h-4" />
                ) : (
                  <Maximize className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
