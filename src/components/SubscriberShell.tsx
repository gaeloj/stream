import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Film,
  History,
  Home,
  Info,
  LogOut,
  Menu,
  Play,
  Search,
  Shield,
  Tv,
  User as UserIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { PlatformCapabilities } from '../platform/deviceAdapter';
import { subscribePlans } from '../services/adminService';
import { signOutAccount, updateBasicAccountName } from '../services/authService';
import {
  subscribeCategories,
  subscribeEpisodesBySeries,
  subscribeMovies,
  subscribeSeasonsBySeries,
  subscribeSeries,
} from '../services/catalogService';
import {
  authorizePlayback,
  stopPlaybackSession,
  subscribeFavorites,
  subscribeWatchHistory,
  toggleFavoriteItem,
} from '../services/playbackService';
import type {
  Category,
  Episode,
  FavoriteItem,
  Movie,
  Season,
  Series,
  SubscriptionPlan,
  UserAccount,
  WatchHistoryItem,
} from '../types/domain';
import {
  formatCurrencyBRL,
  formatDateBR,
  getProviderLabel,
  getStatusLabel,
} from '../utils/formatters';
import { CatalogCarouselRow, PosterCard } from './CatalogCarouselRow';
import { VideoPlayerModal, type PlayerMediaTarget } from './VideoPlayerModal';

interface SubscriberShellProps {
  profile: UserAccount;
  platform: PlatformCapabilities;
  onOpenAdmin?: () => void;
}

type SubscriberTab = 'home' | 'movies' | 'series' | 'mylist' | 'plans' | 'account';

type HeroSpotlight =
  | { kind: 'movie'; item: Movie }
  | { kind: 'series'; item: Series };

export const SubscriberShell: React.FC<SubscriberShellProps> = ({
  profile,
  platform,
  onOpenAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<SubscriberTab>('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string>('');
  const [heroPreviewReady, setHeroPreviewReady] = useState(false);
  const [heroPreviewMuted, setHeroPreviewMuted] = useState(true);

  // Series detail modal
  const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
  const [seriesSeasons, setSeriesSeasons] = useState<Season[]>([]);
  const [seriesEpisodes, setSeriesEpisodes] = useState<Episode[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState<string>('');

  // Movie detail / player modal
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playerNotice, setPlayerNotice] = useState<string | null>(null);
  const [activePlayerTarget, setActivePlayerTarget] = useState<PlayerMediaTarget | null>(null);

  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  const [nameInput, setNameInput] = useState(profile.name);
  const [savingName, setSavingName] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setNameInput(profile.name);
  }, [profile.name]);

  useEffect(() => {
    const unsubPlans = subscribePlans(false, setPlans, (err) => console.error(err));
    const unsubCats = subscribeCategories(false, setCategories, (err) => console.error(err));
    const unsubMovies = subscribeMovies(false, setMovies, (err) => console.error(err));
    const unsubSeries = subscribeSeries(false, setSeriesList, (err) => console.error(err));
    const unsubHistory = subscribeWatchHistory(profile.uid, setWatchHistory, (err) =>
      console.error(err)
    );
    const unsubFavorites = subscribeFavorites(profile.uid, setFavorites, (err) =>
      console.error(err)
    );

    return () => {
      unsubPlans();
      unsubCats();
      unsubMovies();
      unsubSeries();
      unsubHistory();
      unsubFavorites();
    };
  }, [profile.uid]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [menuOpen]);

  const activeSeriesId =
    selectedSeries?.id ||
    (activePlayerTarget?.mediaType === 'episode' ? activePlayerTarget.seriesId || null : null);

  useEffect(() => {
    if (!activeSeriesId) {
      setSeriesSeasons([]);
      setSeriesEpisodes([]);
      setActiveSeasonId('');
      return;
    }

    const unsubSeasons = subscribeSeasonsBySeries(
      activeSeriesId,
      false,
      (items) => {
        setSeriesSeasons(items);
        setActiveSeasonId((prev) =>
          items.some((s) => s.id === prev) ? prev : items[0]?.id || ''
        );
      },
      (err) => console.error(err)
    );

    const unsubEpisodes = subscribeEpisodesBySeries(
      activeSeriesId,
      false,
      setSeriesEpisodes,
      (err) => console.error(err)
    );

    return () => {
      unsubSeasons();
      unsubEpisodes();
    };
  }, [activeSeriesId]);

  const filteredMovies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return movies.filter((m) => {
      const matchCat = selectedCategoryId === 'all' || m.categoryId === selectedCategoryId;
      const matchSearch =
        !q || m.title.toLowerCase().includes(q) || m.genre.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [movies, selectedCategoryId, searchQuery]);

  const filteredSeries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return seriesList.filter((s) => {
      const matchCat = selectedCategoryId === 'all' || s.categoryId === selectedCategoryId;
      const matchSearch =
        !q || s.title.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });
  }, [seriesList, selectedCategoryId, searchQuery]);

  const spotlightList = useMemo<HeroSpotlight[]>(() => {
    const sortNewestFirst = (a: HeroSpotlight, b: HeroSpotlight) => {
      const aMs = a.item.createdAt?.toMillis?.() ?? 0;
      const bMs = b.item.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    };
    const featured: HeroSpotlight[] = [
      ...movies.filter((m) => m.featured).map((item) => ({ kind: 'movie' as const, item })),
      ...seriesList.filter((s) => s.featured).map((item) => ({ kind: 'series' as const, item })),
    ].sort(sortNewestFirst);
    if (featured.length > 0) return featured;
    const fallback: HeroSpotlight[] = [
      ...(movies[0] ? [{ kind: 'movie' as const, item: movies[0] }] : []),
      ...(seriesList[0] ? [{ kind: 'series' as const, item: seriesList[0] }] : []),
    ].sort(sortNewestFirst);
    return fallback;
  }, [movies, seriesList]);

  const topSpotlightId = spotlightList[0]?.item.id;
  useEffect(() => {
    setHeroIndex(0);
  }, [topSpotlightId]);

  const featuredItem = spotlightList.length > 0 ? spotlightList[heroIndex % spotlightList.length] : null;
  const featuredId = featuredItem?.item.id || '';
  const featuredHasTrailer = Boolean(featuredItem?.item.hasTrailer);

  useEffect(() => {
    let cancelled = false;
    let activeSessionId = '';
    setHeroPreviewUrl('');
    setHeroPreviewReady(false);
    setHeroPreviewMuted(true);

    if (
      activeTab !== 'home' ||
      !featuredId ||
      !featuredHasTrailer ||
      activePlayerTarget
    ) {
      return;
    }

    const loadPreview = async () => {
      try {
        const res = await authorizePlayback(`trl_${featuredId}`, 'trailer');
        if (cancelled) {
          void stopPlaybackSession(res.sessionId);
          return;
        }
        activeSessionId = res.sessionId;
        if (res.provider !== 'youtube' && res.streamUrl) {
          setHeroPreviewUrl(res.streamUrl);
        }
      } catch {
        // Silently keep the 16:9 banner backdrop if teaser preview isn't synced yet
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      if (activeSessionId) {
        void stopPlaybackSession(activeSessionId);
      }
    };
  }, [activeTab, featuredId, featuredHasTrailer, activePlayerTarget]);

  const episodesInActiveSeason = useMemo(
    () => seriesEpisodes.filter((ep) => ep.seasonId === activeSeasonId),
    [seriesEpisodes, activeSeasonId]
  );

  const historyByMediaId = useMemo(() => {
    const map = new Map<string, WatchHistoryItem>();
    for (const item of watchHistory) {
      map.set(item.mediaId, item);
    }
    return map;
  }, [watchHistory]);

  const continueWatchingItems = useMemo(
    () => watchHistory.filter((item) => !item.completed && item.progressSeconds > 3),
    [watchHistory]
  );

  const isMovieFavorited = (movieId: string) =>
    favorites.some((f) => f.mediaType === 'movie' && f.mediaId === movieId);

  const isSeriesFavorited = (seriesId: string) =>
    favorites.some((f) => f.mediaType === 'series' && f.mediaId === seriesId);

  const categoryRows = useMemo(() => {
    return categories
      .map((cat) => {
        const catMovies = movies.filter((m) => m.categoryId === cat.id);
        const catSeries = seriesList.filter((s) => s.categoryId === cat.id);
        const combined: Array<
          { kind: 'movie'; item: Movie } | { kind: 'series'; item: Series }
        > = [
          ...catMovies.map((item) => ({ kind: 'movie' as const, item })),
          ...catSeries.map((item) => ({ kind: 'series' as const, item })),
        ];
        return { category: cat, items: combined };
      })
      .filter((row) => row.items.length > 0);
  }, [categories, movies, seriesList]);

  const sortedSeriesEpisodes = useMemo(() => {
    return [...seriesEpisodes].sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber ||
        a.sortOrder - b.sortOrder ||
        a.episodeNumber - b.episodeNumber
    );
  }, [seriesEpisodes]);

  const nextEpisodeTarget = useMemo<PlayerMediaTarget | null>(() => {
    if (!activePlayerTarget || activePlayerTarget.mediaType !== 'episode') return null;
    const idx = sortedSeriesEpisodes.findIndex((ep) => ep.id === activePlayerTarget.mediaId);
    if (idx < 0) return null;
    const nextEp = sortedSeriesEpisodes.slice(idx + 1).find((ep) => ep.hasVideoSource);
    if (!nextEp) return null;
    const parentSeries = seriesList.find((s) => s.id === nextEp.seriesId) || selectedSeries;
    const prevProgress = historyByMediaId.get(nextEp.id);
    return {
      mediaType: 'episode',
      mediaId: nextEp.id,
      seriesId: nextEp.seriesId,
      seasonNumber: nextEp.seasonNumber,
      episodeNumber: nextEp.episodeNumber,
      title: parentSeries?.title || activePlayerTarget.title,
      subtitle: `T${nextEp.seasonNumber} · E${nextEp.episodeNumber} — ${nextEp.title}`,
      posterUrl: nextEp.thumbnailUrl || parentSeries?.posterUrl || activePlayerTarget.posterUrl,
      initialProgressSeconds:
        prevProgress && !prevProgress.completed ? prevProgress.progressSeconds : 0,
    };
  }, [activePlayerTarget, historyByMediaId, selectedSeries, seriesList, sortedSeriesEpisodes]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await updateBasicAccountName(profile.uid, nameInput);
      setSaveMessage('Dados básicos atualizados com sucesso.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro ao atualizar perfil.');
    } finally {
      setSavingName(false);
    }
  };

  const handleLaunchMoviePlayer = (movie: Movie) => {
    if (!movie.hasVideoSource) {
      setPlayerNotice(
        `"${movie.title}" ainda está sem link de vídeo vinculado pelo administrador.`
      );
      return;
    }
    setPlayerNotice(null);
    const prev = historyByMediaId.get(movie.id);
    setActivePlayerTarget({
      mediaType: 'movie',
      mediaId: movie.id,
      title: movie.title,
      subtitle: `${movie.genre} · ${movie.releaseYear}`,
      posterUrl: movie.posterUrl || movie.bannerUrl || '',
      initialProgressSeconds: prev && !prev.completed ? prev.progressSeconds : 0,
    });
  };

  const handleLaunchTrailer = (item: Movie | Series) => {
    setPlayerNotice(null);
    setActivePlayerTarget({
      mediaType: 'trailer',
      mediaId: `trl_${item.id}`,
      title: item.title,
      subtitle: 'Teaser / Trailer Oficial',
      posterUrl: item.bannerUrl || item.posterUrl || '',
      initialProgressSeconds: 0,
    });
  };

  const handleLaunchEpisodePlayer = (series: Series, ep: Episode) => {
    if (!ep.hasVideoSource) {
      setPlayerNotice(
        `O episódio "${ep.title}" ainda está sem link de vídeo vinculado pelo administrador.`
      );
      return;
    }
    setPlayerNotice(null);
    const prev = historyByMediaId.get(ep.id);
    setActivePlayerTarget({
      mediaType: 'episode',
      mediaId: ep.id,
      seriesId: series.id,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      title: series.title,
      subtitle: `T${ep.seasonNumber} · E${ep.episodeNumber} — ${ep.title}`,
      posterUrl: ep.thumbnailUrl || series.posterUrl || series.bannerUrl || '',
      initialProgressSeconds: prev && !prev.completed ? prev.progressSeconds : 0,
    });
  };

  const handlePlayEpisodeFromPlayer = (ep: Episode) => {
    if (!ep.hasVideoSource) return;
    const parentSeries = seriesList.find((s) => s.id === ep.seriesId) || selectedSeries;
    const prev = historyByMediaId.get(ep.id);
    setActivePlayerTarget({
      mediaType: 'episode',
      mediaId: ep.id,
      seriesId: ep.seriesId,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      title: parentSeries?.title || activePlayerTarget?.title || 'Série',
      subtitle: `T${ep.seasonNumber} · E${ep.episodeNumber} — ${ep.title}`,
      posterUrl:
        ep.thumbnailUrl ||
        parentSeries?.posterUrl ||
        parentSeries?.bannerUrl ||
        activePlayerTarget?.posterUrl ||
        '',
      initialProgressSeconds: prev && !prev.completed ? prev.progressSeconds : 0,
    });
  };

  const handleResumeHistoryItem = (item: WatchHistoryItem) => {
    setPlayerNotice(null);
    setActivePlayerTarget({
      mediaType: item.mediaType,
      mediaId: item.mediaId,
      seriesId: item.seriesId ?? null,
      seasonNumber: item.seasonNumber ?? null,
      episodeNumber: item.episodeNumber ?? null,
      title: item.title,
      posterUrl: item.posterUrl,
      initialProgressSeconds: item.completed ? 0 : item.progressSeconds,
    });
  };

  const isBlockedOrFrozen = profile.status === 'blocked' || profile.status === 'frozen';
  const isFilteringHome =
    activeTab === 'home' && (selectedCategoryId !== 'all' || searchQuery.trim().length > 0);

  return (
    <div
      className="min-h-screen bg-[#090A0D] text-[#F3F4F6] flex flex-col"
      style={{
        padding: platform.overscanPaddingPx ? `${platform.overscanPaddingPx}px` : undefined,
      }}
    >
      {/* Top Bar Contract: 3 clean zones */}
      <header className="border-b border-white/8 bg-[#090A0D]/95 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-4 sm:gap-8">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              className="w-11 h-11 -ml-1.5 rounded-lg flex items-center justify-center text-neutral-200 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <a
              href="#inicio"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('home');
              }}
              className="flex items-center gap-2.5 text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            >
              <span className="w-7 h-7 rounded-md bg-[#E11D48] flex items-center justify-center text-white">
                <Film className="w-4 h-4" />
              </span>
              <span>VÉRTICE</span>
            </a>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            {(
              [
                ['home', 'Início'],
                ['movies', 'Filmes'],
                ['series', 'Séries'],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                data-tv-focusable="true"
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 ${
                  activeTab === tab
                    ? 'text-white border-b-2 border-[#E11D48]'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {onOpenAdmin && (
              <button
                type="button"
                data-tv-focusable="true"
                onClick={onOpenAdmin}
                className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#111318] hover:bg-[#181B22] text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Shield className="w-3.5 h-3.5 text-[#FB7185]" />
                <span>Painel Admin</span>
              </button>
            )}
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => signOutAccount()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hamburger Slide-Over Menu Drawer (Mobile + Desktop) */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />
          <aside
            aria-label="Menu de navegação"
            className="relative z-10 w-72 max-w-[85vw] h-full bg-[#0E1016] border-r border-white/10 flex flex-col shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-md bg-[#E11D48] flex items-center justify-center text-white">
                  <Film className="w-4 h-4" />
                </span>
                <span className="font-display text-base font-bold tracking-tight text-white">
                  VÉRTICE
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar menu"
                className="w-10 h-10 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-white/8 space-y-0.5">
              <p className="text-sm font-medium text-white truncate">{profile.name}</p>
              <p className="text-xs text-neutral-400 truncate">{profile.email}</p>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-5">
              <div className="space-y-1">
                <p className="px-3 py-1 text-xs font-medium text-neutral-500">Catálogo</p>
                {(
                  [
                    { id: 'home', label: 'Início', icon: <Home className="w-4 h-4" /> },
                    { id: 'movies', label: 'Filmes', icon: <Film className="w-4 h-4" /> },
                    { id: 'series', label: 'Séries', icon: <Tv className="w-4 h-4" /> },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-tv-focusable="true"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === item.id
                        ? 'bg-[#181B24] text-white border border-white/10'
                        : 'text-neutral-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1 pt-2 border-t border-white/8">
                <p className="px-3 py-1 text-xs font-medium text-neutral-500">Sua Assinatura</p>
                {(
                  [
                    { id: 'mylist', label: 'Minha Lista', icon: <Bookmark className="w-4 h-4" /> },
                    { id: 'plans', label: 'Planos', icon: <CreditCard className="w-4 h-4" /> },
                    { id: 'account', label: 'Conta', icon: <UserIcon className="w-4 h-4" /> },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-tv-focusable="true"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === item.id
                        ? 'bg-[#181B24] text-white border border-white/10'
                        : 'text-neutral-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </nav>

            <div className="p-4 border-t border-white/8 space-y-2">
              {onOpenAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenAdmin();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border border-white/15 bg-[#141720] hover:bg-[#1C202B] text-white transition-colors"
                >
                  <Shield className="w-4 h-4 text-[#FB7185]" />
                  <span>Painel Admin</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => signOutAccount()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Encerrar sessão</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      <main className="flex-1 w-full">
        {isBlockedOrFrozen && (
          <div className="max-w-[1440px] mx-auto px-5 sm:px-8 pt-6">
            <div className="p-5 rounded-xl bg-[#DC2626]/10 border border-[#DC2626]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#FCA5A5]">
                  Conta {getStatusLabel(profile.status)}
                </p>
                <p className="text-sm text-neutral-300">
                  {profile.status === 'blocked'
                    ? 'Sua conta foi bloqueada pela administração. A reprodução de conteúdos está suspensa.'
                    : 'Sua assinatura está temporariamente congelada. Entre em contato com o suporte para descongelamento.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Netflix-style Full-Bleed Hero Billboard on Home */}
        {activeTab === 'home' && (
          <section className="relative w-full min-h-[420px] sm:min-h-[480px] lg:min-h-[540px] flex items-end overflow-hidden bg-[#0E1016]">
            {featuredItem && (featuredItem.item.bannerUrl || featuredItem.item.posterUrl || heroPreviewUrl) ? (
              <>
                {(featuredItem.item.bannerUrl || featuredItem.item.posterUrl) && (
                  <img
                    src={featuredItem.item.bannerUrl || featuredItem.item.posterUrl}
                    alt={featuredItem.item.title}
                    referrerPolicy="no-referrer"
                    className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${
                      heroPreviewReady ? 'opacity-0' : 'opacity-70'
                    }`}
                  />
                )}
                {heroPreviewUrl && (
                  <video
                    key={heroPreviewUrl}
                    src={heroPreviewUrl}
                    autoPlay
                    muted={heroPreviewMuted}
                    loop
                    playsInline
                    onPlaying={() => setHeroPreviewReady(true)}
                    onError={() => {
                      setHeroPreviewReady(false);
                      setHeroPreviewUrl('');
                    }}
                    className={`absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-700 ${
                      heroPreviewReady ? 'opacity-75' : 'opacity-0'
                    }`}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-[#090A0D] via-[#090A0D]/75 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#090A0D] via-[#090A0D]/35 to-black/30" />
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#181B22] via-[#0F1117] to-[#1A1015]" />
            )}

            <div className="relative z-10 max-w-[1440px] w-full mx-auto px-5 sm:px-8 py-10 sm:py-14 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
              {featuredItem ? (
                <div className="space-y-4 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-neutral-300">
                    <span className="text-[#FB7185] font-semibold">
                      {featuredItem.kind === 'movie' ? 'Filme em Destaque' : 'Série em Destaque'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{featuredItem.item.genre}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{featuredItem.item.releaseYear}</span>
                    {featuredItem.kind === 'movie' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {featuredItem.item.durationMinutes} min
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>
                      {featuredItem.item.ageRating === 'L'
                        ? 'Livre'
                        : `${featuredItem.item.ageRating}+`}
                    </span>
                  </div>

                  <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight [text-wrap:balance] leading-[1.08]">
                    {featuredItem.item.title}
                  </h1>

                  <p className="text-sm sm:text-base text-neutral-200 leading-relaxed line-clamp-3 max-w-xl">
                    {featuredItem.item.synopsis}
                  </p>

                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    {featuredItem.kind === 'movie' ? (
                      <button
                        type="button"
                        data-tv-focusable="true"
                        onClick={() => handleLaunchMoviePlayer(featuredItem.item)}
                        className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold rounded-lg bg-white hover:bg-neutral-200 text-[#090A0D] transition-colors whitespace-nowrap"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Assistir agora</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-tv-focusable="true"
                        onClick={() => setSelectedSeries(featuredItem.item)}
                        className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold rounded-lg bg-white hover:bg-neutral-200 text-[#090A0D] transition-colors whitespace-nowrap"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Assistir episódios</span>
                      </button>
                    )}

                    {featuredItem.item.hasTrailer && (
                      <button
                        type="button"
                        data-tv-focusable="true"
                        onClick={() => handleLaunchTrailer(featuredItem.item)}
                        className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap"
                      >
                        <Film className="w-4 h-4" />
                        <span>Assistir Trailer</span>
                      </button>
                    )}

                    <button
                      type="button"
                      data-tv-focusable="true"
                      onClick={() => {
                        if (featuredItem.kind === 'movie') {
                          setSelectedMovie(featuredItem.item);
                        } else {
                          setSelectedSeries(featuredItem.item);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors whitespace-nowrap"
                    >
                      <Info className="w-4 h-4" />
                      <span>Mais detalhes</span>
                    </button>

                    <button
                      type="button"
                      data-tv-focusable="true"
                      onClick={() =>
                        void toggleFavoriteItem(
                          profile.uid,
                          {
                            mediaType: featuredItem.kind,
                            mediaId: featuredItem.item.id,
                            title: featuredItem.item.title,
                            posterUrl:
                              featuredItem.item.posterUrl || featuredItem.item.bannerUrl || '',
                            genre: featuredItem.item.genre,
                            releaseYear: featuredItem.item.releaseYear,
                          },
                          featuredItem.kind === 'movie'
                            ? isMovieFavorited(featuredItem.item.id)
                            : isSeriesFavorited(featuredItem.item.id)
                        )
                      }
                      className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-lg border border-white/20 bg-black/40 hover:bg-black/60 text-white transition-colors whitespace-nowrap"
                    >
                      <Bookmark
                        className={`w-4 h-4 ${
                          (featuredItem.kind === 'movie'
                            ? isMovieFavorited(featuredItem.item.id)
                            : isSeriesFavorited(featuredItem.item.id))
                            ? 'fill-[#E11D48] text-[#E11D48]'
                            : ''
                        }`}
                      />
                      <span>Minha Lista</span>
                    </button>

                    {spotlightList.length > 1 && (
                      <div className="flex items-center gap-1 ml-1">
                        <button
                          type="button"
                          onClick={() =>
                            setHeroIndex(
                              (idx) => (idx - 1 + spotlightList.length) % spotlightList.length
                            )
                          }
                          aria-label="Destaque anterior"
                          className="p-2.5 rounded-lg bg-black/40 border border-white/15 hover:bg-white/15 text-white transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setHeroIndex((idx) => (idx + 1) % spotlightList.length)}
                          aria-label="Próximo destaque"
                          className="p-2.5 rounded-lg bg-black/40 border border-white/15 hover:bg-white/15 text-white transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3 max-w-2xl">
                  <p className="text-xs font-medium text-[#FB7185]">
                    Catálogo Multiplataforma · {platform.label}
                  </p>
                  <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight [text-wrap:balance]">
                    Olá, {profile.name}. Catálogo pronto para publicação.
                  </h1>
                  <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
                    Assim que filmes e séries forem publicados no Painel Administrativo, eles aparecerão automaticamente em fileiras aqui para navegação.
                  </p>
                </div>
              )}

              {(heroPreviewReady || spotlightList.length > 1) && featuredItem && (
                <div className="flex items-center gap-3 self-start lg:self-end shrink-0">
                  {spotlightList.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      {spotlightList.map((entry, idx) => {
                        const isActive = idx === heroIndex % spotlightList.length;
                        return (
                          <button
                            key={entry.item.id}
                            type="button"
                            onClick={() => setHeroIndex(idx)}
                            aria-label={`Ver destaque ${entry.item.title}`}
                            className={`h-1 rounded-full transition-all ${
                              isActive ? 'w-7 bg-[#E11D48]' : 'w-3 bg-white/30 hover:bg-white/60'
                            }`}
                          />
                        );
                      })}
                    </div>
                  )}
                  {heroPreviewReady && (
                    <button
                      type="button"
                      onClick={() => setHeroPreviewMuted((m) => !m)}
                      aria-label={heroPreviewMuted ? 'Ativar áudio da prévia' : 'Silenciar prévia'}
                      className="p-2.5 rounded-full bg-black/60 border border-white/20 hover:bg-black/80 text-white transition-colors"
                    >
                      {heroPreviewMuted ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 py-8 space-y-10">
          {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'series') && (
            <div className="space-y-10">
              {/* Search & Category Filter Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Pesquisar filmes, séries ou gêneros..."
                    className="w-full pl-10 pr-4 py-2.5 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:border-[#E11D48] focus:outline-none"
                  />
                </div>

                {categories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111318] border border-white/8 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryId('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        selectedCategoryId === 'all'
                          ? 'bg-[#1F242D] text-white'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      Todas
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoryId(cat.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          selectedCategoryId === cat.id
                            ? 'bg-[#1F242D] text-white'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* HOME CAROUSEL EXPERIENCE (side-by-side rows) */}
              {activeTab === 'home' && !isFilteringHome && (
                <div className="space-y-10">
                  {continueWatchingItems.length > 0 && (
                    <CatalogCarouselRow
                      title="Continuar Assistindo"
                      subtitle="Retome de onde parou"
                    >
                      {continueWatchingItems.map((item) => {
                        const pct =
                          item.durationSeconds > 0
                            ? Math.min(
                                100,
                                Math.round((item.progressSeconds / item.durationSeconds) * 100)
                              )
                            : 10;
                        const remainMin =
                          item.durationSeconds > item.progressSeconds
                            ? Math.max(
                                1,
                                Math.ceil((item.durationSeconds - item.progressSeconds) / 60)
                              )
                            : null;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-tv-focusable="true"
                            onClick={() => handleResumeHistoryItem(item)}
                            className="w-[236px] sm:w-[268px] md:w-[288px] shrink-0 snap-start group text-left space-y-2 focus:outline-none"
                          >
                            <div className="aspect-video w-full rounded-lg overflow-hidden bg-[#14171F] border border-white/10 group-hover:border-white/40 group-hover:scale-[1.03] transition-transform duration-200 relative">
                              {item.posterUrl ? (
                                <img
                                  src={item.posterUrl}
                                  alt={item.title}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover opacity-85 group-hover:opacity-100 transition-opacity"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1B202C] to-[#0D1017] text-neutral-400">
                                  <Film className="w-6 h-6" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/25 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                <span className="w-11 h-11 rounded-full bg-white/95 text-[#090A0D] flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                                  <Play className="w-4 h-4 fill-current ml-0.5" />
                                </span>
                              </div>
                              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                                <div
                                  className="h-full bg-[#E11D48]"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 px-0.5">
                              <p className="text-sm font-medium text-white truncate">
                                {item.title}
                              </p>
                              {remainMin !== null && (
                                <span className="font-mono text-xs text-neutral-400 tabular-nums shrink-0">
                                  -{remainMin}m
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </CatalogCarouselRow>
                  )}

                  {/* Row 1: All Movies Side-by-Side */}
                  <CatalogCarouselRow
                    title="Filmes no Catálogo"
                    subtitle={
                      movies.length > 0 ? `${movies.length} título(s)` : undefined
                    }
                  >
                    {movies.length === 0 ? (
                      <div className="w-full p-8 rounded-xl bg-[#111318] border border-white/8 text-sm text-neutral-400">
                        Nenhum filme publicado ainda.
                      </div>
                    ) : (
                      movies.map((movie) => (
                        <PosterCard
                          key={movie.id}
                          layout="carousel"
                          kind="movie"
                          title={movie.title}
                          meta={`${movie.genre} · ${movie.releaseYear} · ${movie.durationMinutes} min`}
                          posterUrl={movie.posterUrl}
                          bannerUrl={movie.bannerUrl}
                          ageRating={movie.ageRating}
                          onClick={() => setSelectedMovie(movie)}
                        />
                      ))
                    )}
                  </CatalogCarouselRow>

                  {/* Row 2: All Series Side-by-Side */}
                  {seriesList.length > 0 && (
                    <CatalogCarouselRow
                      title="Séries para Maratonar"
                      subtitle={`${seriesList.length} série(s)`}
                    >
                      {seriesList.map((series) => (
                        <PosterCard
                          key={series.id}
                          layout="carousel"
                          kind="series"
                          title={series.title}
                          meta={`${series.genre} · ${series.releaseYear}`}
                          posterUrl={series.posterUrl}
                          bannerUrl={series.bannerUrl}
                          ageRating={series.ageRating}
                          onClick={() => setSelectedSeries(series)}
                        />
                      ))}
                    </CatalogCarouselRow>
                  )}

                  {/* Category Rows Side-by-Side */}
                  {categoryRows.map(({ category, items }) => (
                    <CatalogCarouselRow
                      key={category.id}
                      title={category.name}
                      subtitle={`${items.length} título(s)`}
                    >
                      {items.map((entry) =>
                        entry.kind === 'movie' ? (
                          <PosterCard
                            key={`cat-${category.id}-mov-${entry.item.id}`}
                            layout="carousel"
                            kind="movie"
                            title={entry.item.title}
                            meta={`${entry.item.releaseYear} · ${entry.item.durationMinutes} min`}
                            posterUrl={entry.item.posterUrl}
                            bannerUrl={entry.item.bannerUrl}
                            ageRating={entry.item.ageRating}
                            onClick={() => setSelectedMovie(entry.item)}
                          />
                        ) : (
                          <PosterCard
                            key={`cat-${category.id}-ser-${entry.item.id}`}
                            layout="carousel"
                            kind="series"
                            title={entry.item.title}
                            meta={`Série · ${entry.item.releaseYear}`}
                            posterUrl={entry.item.posterUrl}
                            bannerUrl={entry.item.bannerUrl}
                            ageRating={entry.item.ageRating}
                            onClick={() => setSelectedSeries(entry.item)}
                          />
                        )
                      )}
                    </CatalogCarouselRow>
                  ))}
                </div>
              )}

              {/* FILTERED HOME / DEDICATED MOVIES & SERIES GRIDS */}
              {(isFilteringHome || activeTab === 'movies') && (
                <section className="space-y-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-display text-xl font-semibold text-white">Filmes</h2>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      {filteredMovies.length} resultado(s)
                    </span>
                  </div>
                  {filteredMovies.length === 0 ? (
                    <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-sm text-neutral-400">
                      Nenhum filme publicado encontrado para este filtro.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
                      {filteredMovies.map((movie) => (
                        <PosterCard
                          key={movie.id}
                          layout="grid"
                          kind="movie"
                          title={movie.title}
                          meta={`${movie.genre} · ${movie.releaseYear} · ${movie.durationMinutes} min`}
                          posterUrl={movie.posterUrl}
                          bannerUrl={movie.bannerUrl}
                          ageRating={movie.ageRating}
                          onClick={() => setSelectedMovie(movie)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {(isFilteringHome || activeTab === 'series') && (
                <section className="space-y-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-display text-xl font-semibold text-white">Séries</h2>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">
                      {filteredSeries.length} resultado(s)
                    </span>
                  </div>
                  {filteredSeries.length === 0 ? (
                    <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-sm text-neutral-400">
                      Nenhuma série publicada encontrada para este filtro.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
                      {filteredSeries.map((series) => (
                        <PosterCard
                          key={series.id}
                          layout="grid"
                          kind="series"
                          title={series.title}
                          meta={`${series.genre} · ${series.releaseYear}`}
                          posterUrl={series.posterUrl}
                          bannerUrl={series.bannerUrl}
                          ageRating={series.ageRating}
                          onClick={() => setSelectedSeries(series)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {activeTab === 'mylist' && (
            <section className="space-y-8">
              <div className="space-y-1">
                <h2 className="font-display text-2xl font-semibold text-white">Minha Lista</h2>
                <p className="text-sm text-neutral-400">
                  Seus filmes e séries salvos para assistir quando quiser.
                </p>
              </div>

              {favorites.length === 0 ? (
                <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-sm text-neutral-400">
                  Sua lista está vazia. Abra qualquer filme ou série e clique em &ldquo;Favoritar&rdquo;.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
                  {favorites.map((fav) => (
                    <PosterCard
                      key={fav.id}
                      layout="grid"
                      kind={fav.mediaType}
                      title={fav.title}
                      meta={`${fav.genre} · ${fav.releaseYear}`}
                      posterUrl={fav.posterUrl}
                      onClick={() => {
                        if (fav.mediaType === 'movie') {
                          const m = movies.find((item) => item.id === fav.mediaId);
                          if (m) setSelectedMovie(m);
                        } else {
                          const s = seriesList.find((item) => item.id === fav.mediaId);
                          if (s) setSelectedSeries(s);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'plans' && (
            <section className="space-y-6">
              <div className="space-y-1">
                <h2 className="font-display text-2xl font-semibold text-white">
                  Planos disponíveis
                </h2>
                <p className="text-sm text-neutral-400">
                  Valores e benefícios configurados em tempo real pelo administrador da plataforma.
                </p>
              </div>

              {plans.length === 0 ? (
                <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-sm text-neutral-400">
                  Nenhum plano ativo foi publicado ainda pela administração.
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-6">
                  {plans.map((plan) => (
                    <div
                      key={plan.id}
                      className="p-6 rounded-xl bg-[#111318] border border-white/8 flex flex-col justify-between space-y-6"
                    >
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between gap-4">
                          <h3 className="font-display text-lg font-semibold text-white">
                            {plan.name}
                          </h3>
                          <span className="font-mono text-xs text-neutral-400 tabular-nums">
                            {plan.durationDays} dias
                          </span>
                        </div>
                        <p className="font-mono text-2xl font-semibold text-white tabular-nums">
                          {formatCurrencyBRL(plan.priceCents, plan.currency)}
                        </p>
                        <p className="text-sm text-neutral-400 leading-relaxed">
                          {plan.description}
                        </p>
                        {plan.benefits.length > 0 && (
                          <ul className="pt-2 space-y-2 border-t border-white/8">
                            {plan.benefits.map((benefit, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2 text-xs text-neutral-300"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-[#4ADE80] shrink-0 mt-0.5" />
                                <span>{benefit}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="pt-2 text-xs text-neutral-500">
                        Contratação via Pix/Cartão com confirmação por webhook será ativada na Etapa 4.
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'account' && (
            <section className="max-w-3xl space-y-8">
              <div className="space-y-1">
                <h2 className="font-display text-2xl font-semibold text-white">
                  Minha Conta
                </h2>
                <p className="text-sm text-neutral-400">
                  Consulte o estado da sua assinatura, histórico de reprodução e atualize seu nome.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-[#111318] border border-white/8 space-y-6">
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-neutral-400 block">E-mail</span>
                    <span className="text-white font-medium">{profile.email}</span>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-400 block">Método de acesso</span>
                    <span className="text-white font-medium">
                      {getProviderLabel(profile.authProvider)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-400 block">Plano atual</span>
                    <span className="text-white font-medium">
                      {profile.planName || 'Sem plano contratado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-neutral-400 block">Vencimento</span>
                    <span className="text-white font-mono tabular-nums">
                      {formatDateBR(profile.subscriptionExpiresAt)}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSaveName} className="pt-6 border-t border-white/8 space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="profile-name"
                      className="block text-xs font-medium text-neutral-300"
                    >
                      Nome de exibição
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="profile-name"
                        type="text"
                        required
                        maxLength={120}
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white focus:border-[#E11D48] focus:outline-none"
                      />
                    </div>
                  </div>

                  {saveMessage && <p className="text-xs text-[#4ADE80]">{saveMessage}</p>}
                  {saveError && <p className="text-xs text-[#F87171]">{saveError}</p>}

                  <button
                    type="submit"
                    data-tv-focusable="true"
                    disabled={savingName}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors disabled:opacity-50"
                  >
                    {savingName ? 'Salvando...' : 'Salvar nome'}
                  </button>
                </form>
              </div>

              {/* Watch History Log */}
              <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/8 flex items-center gap-2">
                  <History className="w-4 h-4 text-[#FB7185]" />
                  <h3 className="font-display text-base font-semibold text-white">
                    Histórico de Reprodução
                  </h3>
                </div>
                {watchHistory.length === 0 ? (
                  <p className="p-6 text-sm text-neutral-400">
                    Você ainda não iniciou nenhuma reprodução.
                  </p>
                ) : (
                  <div className="divide-y divide-white/8">
                    {watchHistory.slice(0, 15).map((item) => (
                      <div
                        key={item.id}
                        className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.02]"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.title}</p>
                          <p className="text-xs text-neutral-400 font-mono tabular-nums">
                            {item.completed
                              ? 'Concluído'
                              : `${Math.floor(item.progressSeconds / 60)} min assistidos`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResumeHistoryItem(item)}
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-xs font-medium text-white"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>{item.completed ? 'Reassistir' : 'Continuar'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Modal: Detalhes do Filme */}
      {selectedMovie && (
        <div
          onClick={() => {
            setSelectedMovie(null);
            setPlayerNotice(null);
          }}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-[#111318] border border-white/12 rounded-xl overflow-hidden shadow-2xl my-8"
          >
            <div className="h-56 sm:h-64 w-full relative bg-[#0B0D12]">
              {(selectedMovie.bannerUrl || selectedMovie.posterUrl) && (
                <img
                  src={selectedMovie.bannerUrl || selectedMovie.posterUrl}
                  alt={selectedMovie.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111318] via-[#111318]/45 to-transparent" />
              <button
                type="button"
                onClick={() => {
                  setSelectedMovie(null);
                  setPlayerNotice(null);
                }}
                aria-label="Fechar detalhes"
                className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="absolute bottom-4 left-6 right-6 flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-display text-2xl sm:text-3xl font-bold text-white">
                    {selectedMovie.title}
                  </h3>
                  <p className="text-xs text-neutral-300">
                    {selectedMovie.genre} · {selectedMovie.releaseYear} ·{' '}
                    {selectedMovie.durationMinutes} min ·{' '}
                    {selectedMovie.ageRating === 'L'
                      ? 'Livre'
                      : `Classificação ${selectedMovie.ageRating}`}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-sm text-neutral-200 leading-relaxed">{selectedMovie.synopsis}</p>
              <p className="text-xs text-neutral-400">
                Áudio: {selectedMovie.language}
                {selectedMovie.subtitlesLabel
                  ? ` · Legendas: ${selectedMovie.subtitlesLabel}`
                  : ''}
              </p>

              {playerNotice && (
                <div className="p-3 rounded-lg bg-[#181B22] border border-white/10 text-xs text-neutral-200">
                  {playerNotice}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-tv-focusable="true"
                  onClick={() => handleLaunchMoviePlayer(selectedMovie)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-lg bg-white hover:bg-neutral-200 text-[#090A0D] transition-colors"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {historyByMediaId.get(selectedMovie.id)?.progressSeconds &&
                    !historyByMediaId.get(selectedMovie.id)?.completed
                      ? 'Continuar filme'
                      : 'Assistir agora'}
                  </span>
                </button>

                {selectedMovie.hasTrailer && (
                  <button
                    type="button"
                    data-tv-focusable="true"
                    onClick={() => handleLaunchTrailer(selectedMovie)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors"
                  >
                    <Film className="w-4 h-4" />
                    <span>Assistir Trailer</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    void toggleFavoriteItem(
                      profile.uid,
                      {
                        mediaType: 'movie',
                        mediaId: selectedMovie.id,
                        title: selectedMovie.title,
                        posterUrl: selectedMovie.posterUrl || selectedMovie.bannerUrl || '',
                        genre: selectedMovie.genre,
                        releaseYear: selectedMovie.releaseYear,
                      },
                      isMovieFavorited(selectedMovie.id)
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-white"
                >
                  <Bookmark
                    className={`w-4 h-4 ${
                      isMovieFavorited(selectedMovie.id) ? 'fill-[#E11D48] text-[#E11D48]' : ''
                    }`}
                  />
                  <span>
                    {isMovieFavorited(selectedMovie.id) ? 'Na Minha Lista' : 'Favoritar'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Detalhes da Série, Temporadas & Episódios */}
      {selectedSeries && (
        <div
          onClick={() => {
            setSelectedSeries(null);
            setPlayerNotice(null);
          }}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-[#111318] border border-white/12 rounded-xl overflow-hidden shadow-2xl my-8"
          >
            <div className="h-52 sm:h-60 w-full relative bg-[#0B0D12]">
              {(selectedSeries.bannerUrl || selectedSeries.posterUrl) && (
                <img
                  src={selectedSeries.bannerUrl || selectedSeries.posterUrl}
                  alt={selectedSeries.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111318] via-[#111318]/45 to-transparent" />
              <button
                type="button"
                onClick={() => {
                  setSelectedSeries(null);
                  setPlayerNotice(null);
                }}
                aria-label="Fechar série"
                className="absolute top-4 right-4 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="absolute bottom-4 left-6 right-6 flex flex-wrap items-end justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="font-display text-2xl sm:text-3xl font-bold text-white">
                    {selectedSeries.title}
                  </h3>
                  <p className="text-xs text-neutral-300">
                    {selectedSeries.genre} · {selectedSeries.releaseYear} · Classif.{' '}
                    {selectedSeries.ageRating} · {selectedSeries.language}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedSeries.hasTrailer && (
                    <button
                      type="button"
                      data-tv-focusable="true"
                      onClick={() => handleLaunchTrailer(selectedSeries)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Assistir Trailer</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void toggleFavoriteItem(
                        profile.uid,
                        {
                          mediaType: 'series',
                          mediaId: selectedSeries.id,
                          title: selectedSeries.title,
                          posterUrl: selectedSeries.posterUrl || selectedSeries.bannerUrl || '',
                          genre: selectedSeries.genre,
                          releaseYear: selectedSeries.releaseYear,
                        },
                        isSeriesFavorited(selectedSeries.id)
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/20 bg-black/50 hover:bg-black/70 text-white"
                  >
                    <Bookmark
                      className={`w-3.5 h-3.5 ${
                        isSeriesFavorited(selectedSeries.id) ? 'fill-[#E11D48] text-[#E11D48]' : ''
                      }`}
                    />
                    <span>
                      {isSeriesFavorited(selectedSeries.id) ? 'Na Minha Lista' : 'Favoritar'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-sm text-neutral-200 leading-relaxed">
                {selectedSeries.synopsis}
              </p>

              {playerNotice && (
                <div className="p-3 rounded-lg bg-[#181B22] border border-white/10 text-xs text-neutral-200">
                  {playerNotice}
                </div>
              )}

              {seriesSeasons.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  Nenhuma temporada publicada para esta série ainda.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-1 p-1 bg-[#090A0D] border border-white/8 rounded-lg">
                    {seriesSeasons.map((season) => (
                      <button
                        key={season.id}
                        type="button"
                        onClick={() => setActiveSeasonId(season.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          activeSeasonId === season.id
                            ? 'bg-[#1F242D] text-white'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {season.title}
                      </button>
                    ))}
                  </div>

                  <div className="divide-y divide-white/8 border border-white/8 rounded-lg overflow-hidden">
                    {episodesInActiveSeason.length === 0 ? (
                      <p className="p-4 text-xs text-neutral-400">
                        Nenhum episódio publicado nesta temporada.
                      </p>
                    ) : (
                      episodesInActiveSeason.map((ep) => {
                        const epHistory = historyByMediaId.get(ep.id);
                        const epPct =
                          epHistory && epHistory.durationSeconds > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (epHistory.progressSeconds / epHistory.durationSeconds) * 100
                                )
                              )
                            : 0;
                        return (
                          <div
                            key={ep.id}
                            className="p-4 flex items-center justify-between gap-4 hover:bg-white/[0.03] transition-colors"
                          >
                            <div className="flex items-center gap-4 min-w-0 flex-1">
                              {ep.thumbnailUrl && (
                                <div className="hidden sm:block w-28 aspect-video rounded-md overflow-hidden bg-[#090A0D] shrink-0 relative">
                                  <img
                                    src={ep.thumbnailUrl}
                                    alt={ep.title}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                  {epPct > 0 && (
                                    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                                      <div
                                        className="h-full bg-[#E11D48]"
                                        style={{ width: `${epPct}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-medium text-white truncate">
                                  {ep.episodeNumber}. {ep.title}
                                </p>
                                <p className="text-xs text-neutral-400 line-clamp-2">
                                  {ep.description}
                                </p>
                                <p className="font-mono text-xs text-neutral-500 tabular-nums">
                                  {ep.durationMinutes} min
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-tv-focusable="true"
                              onClick={() => handleLaunchEpisodePlayer(selectedSeries, ep)}
                              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white hover:bg-neutral-200 text-[#090A0D] transition-colors"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Assistir</span>
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom HTML5 Video Player Overlay */}
      {activePlayerTarget && (
        <VideoPlayerModal
          uid={profile.uid}
          target={activePlayerTarget}
          nextEpisodeTarget={nextEpisodeTarget}
          seasons={activePlayerTarget.mediaType === 'episode' ? seriesSeasons : undefined}
          episodes={activePlayerTarget.mediaType === 'episode' ? sortedSeriesEpisodes : undefined}
          historyByMediaId={
            activePlayerTarget.mediaType === 'episode' ? historyByMediaId : undefined
          }
          onPlayEpisode={handlePlayEpisodeFromPlayer}
          onSelectTarget={(next) => setActivePlayerTarget(next)}
          onOpenPlans={() => {
            setActivePlayerTarget(null);
            setSelectedMovie(null);
            setSelectedSeries(null);
            setActiveTab('plans');
          }}
          onClose={() => setActivePlayerTarget(null)}
        />
      )}
    </div>
  );
};
