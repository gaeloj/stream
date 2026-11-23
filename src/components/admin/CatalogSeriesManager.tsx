import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Layers,
  Link2,
  Plus,
  Search,
  Trash2,
  Tv,
  Video,
  X,
} from 'lucide-react';
import {
  addSeasonsAndEpisodesToSeries,
  deleteEpisodeWithMedia,
  deleteSeason,
  deleteSeries,
  getMediaSourceForAdmin,
  saveEpisodeWithMedia,
  saveEpisodesBatchWithMedia,
  saveSeries,
  saveSeriesWithSeasonsAndEpisodes,
  subscribeEpisodesBySeries,
  subscribeSeasonsBySeries,
  type DraftEpisodeInput,
  type DraftSeasonInput,
} from '../../services/catalogService';
import type {
  AgeRating,
  Category,
  Episode,
  MediaProviderType,
  PublishStatus,
  Season,
  Series,
  UserAccount,
} from '../../types/domain';
import { extractDriveFileId, extractYouTubeVideoId } from '../../utils/mediaLinks';

interface CatalogSeriesManagerProps {
  currentAdmin: UserAccount;
  categories: Category[];
  seriesList: Series[];
  onNotify: (type: 'success' | 'error', text: string) => void;
}

interface EpisodeDraftRow {
  localId: string;
  episodeNumber: number;
  title: string;
  durationMinutes: number;
  provider: MediaProviderType;
  rawVideoLinkOrId: string;
  qualityLabel: string;
  subtitleUrl: string;
  thumbnailUrl: string;
  description: string;
  showExtras: boolean;
}

interface SeasonDraftBlock {
  localId: string;
  seasonNumber: number;
  title: string;
  customTitle: boolean;
  synopsis: string;
  status: PublishStatus;
  episodes: EpisodeDraftRow[];
}

function makeLocalId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function createEpisodeDraftRow(episodeNumber: number): EpisodeDraftRow {
  return {
    localId: makeLocalId('dep'),
    episodeNumber,
    title: '',
    durationMinutes: 45,
    provider: 'google_drive',
    rawVideoLinkOrId: '',
    qualityLabel: '1080p Full HD',
    subtitleUrl: '',
    thumbnailUrl: '',
    description: '',
    showExtras: false,
  };
}

function createSeasonDraftBlock(seasonNumber: number): SeasonDraftBlock {
  return {
    localId: makeLocalId('dsea'),
    seasonNumber,
    title: `Temporada ${seasonNumber}`,
    customTitle: false,
    synopsis: '',
    status: 'published',
    episodes: [createEpisodeDraftRow(1)],
  };
}

function toDraftEpisodeInputs(rows: EpisodeDraftRow[], status: PublishStatus): DraftEpisodeInput[] {
  return rows.map((row) => ({
    episodeNumber: Math.max(1, Math.round(row.episodeNumber || 1)),
    title: row.title,
    description: row.description,
    durationMinutes: Math.max(1, Math.round(row.durationMinutes || 45)),
    thumbnailUrl: row.thumbnailUrl,
    subtitlesLabel: 'PT-BR, EN',
    status,
    provider: row.provider,
    rawVideoLinkOrId: row.rawVideoLinkOrId,
    subtitleUrl: row.subtitleUrl,
    qualityLabel: row.qualityLabel,
  }));
}

function toDraftSeasonInputs(blocks: SeasonDraftBlock[]): DraftSeasonInput[] {
  return blocks.map((block) => ({
    seasonNumber: Math.max(1, Math.round(block.seasonNumber || 1)),
    title: block.title,
    synopsis: block.synopsis,
    status: block.status,
    episodes: toDraftEpisodeInputs(block.episodes, block.status),
  }));
}

interface EpisodeRowsBuilderProps {
  rows: EpisodeDraftRow[];
  onChange: (nextRows: EpisodeDraftRow[]) => void;
}

const EpisodeRowsBuilder: React.FC<EpisodeRowsBuilderProps> = ({ rows, onChange }) => {
  const updateRow = (localId: string, patch: Partial<EpisodeDraftRow>) => {
    onChange(rows.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  };

  const removeRow = (localId: string) => {
    onChange(rows.filter((r) => r.localId !== localId));
  };

  const addNextEpisode = () => {
    const maxEp = rows.reduce((max, r) => Math.max(max, Number(r.episodeNumber) || 0), 0);
    onChange([...rows, createEpisodeDraftRow(maxEp + 1)]);
  };

  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const driveId =
          row.provider === 'google_drive' ? extractDriveFileId(row.rawVideoLinkOrId) : '';
        const hasLinkText = row.rawVideoLinkOrId.trim().length > 0;

        return (
          <div
            key={row.localId}
            className="p-3 rounded-lg bg-[#0B0D12] border border-white/10 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-[#FB7185] tabular-nums">
                  Episódio {row.episodeNumber}
                </span>
                {hasLinkText && row.provider === 'google_drive' && (
                  <span
                    className={`font-mono text-[11px] ${
                      driveId ? 'text-[#4ADE80]' : 'text-[#F87171]'
                    }`}
                  >
                    {driveId ? `· Drive OK (${driveId.slice(0, 10)}…)` : '· Link Drive inválido'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateRow(row.localId, { showExtras: !row.showExtras })}
                  className="text-[11px] text-neutral-400 hover:text-white transition-colors"
                >
                  {row.showExtras ? 'Ocultar extras' : 'Capa / Legenda'}
                </button>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.localId)}
                    title={`Remover Episódio ${row.episodeNumber}`}
                    className="p-1 rounded text-neutral-400 hover:text-[#F87171] hover:bg-[#DC2626]/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-[11px] text-neutral-400">Ep. Nº</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  required
                  value={row.episodeNumber}
                  onChange={(e) =>
                    updateRow(row.localId, { episodeNumber: Number(e.target.value) })
                  }
                  className="w-full px-2.5 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white font-mono tabular-nums"
                />
              </div>

              <div className="sm:col-span-4 space-y-1">
                <label className="block text-[11px] text-neutral-400">
                  Título (opcional)
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={row.title}
                  onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                  placeholder={`Episódio ${row.episodeNumber}`}
                  className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white placeholder:text-neutral-600"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <label className="block text-[11px] text-neutral-400">Origem</label>
                <select
                  value={row.provider}
                  onChange={(e) =>
                    updateRow(row.localId, { provider: e.target.value as MediaProviderType })
                  }
                  className="w-full px-2.5 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white"
                >
                  <option value="google_drive">Drive</option>
                  <option value="gcs_hls">MP4 / HLS</option>
                </select>
              </div>

              <div className="sm:col-span-4 space-y-1">
                <label className="block text-[11px] text-neutral-400">
                  Link do episódio
                </label>
                <input
                  type="text"
                  maxLength={1000}
                  value={row.rawVideoLinkOrId}
                  onChange={(e) =>
                    updateRow(row.localId, { rawVideoLinkOrId: e.target.value })
                  }
                  placeholder={
                    row.provider === 'google_drive'
                      ? 'https://drive.google.com/file/d/...'
                      : 'https://.../episodio.mp4'
                  }
                  className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white font-mono placeholder:text-neutral-600"
                />
              </div>
            </div>

            {row.showExtras && (
              <div className="pt-2 border-t border-white/8 grid sm:grid-cols-3 gap-2.5">
                <div className="space-y-1">
                  <label className="block text-[11px] text-neutral-400">Duração (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={row.durationMinutes}
                    onChange={(e) =>
                      updateRow(row.localId, { durationMinutes: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-1.5 bg-[#111318] border border-white/10 rounded-lg text-xs text-white font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-neutral-400">
                    URL Capa (opcional)
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={row.thumbnailUrl}
                    onChange={(e) =>
                      updateRow(row.localId, { thumbnailUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full px-2.5 py-1.5 bg-[#111318] border border-white/10 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] text-neutral-400">
                    Legenda .vtt (opcional)
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={row.subtitleUrl}
                    onChange={(e) =>
                      updateRow(row.localId, { subtitleUrl: e.target.value })
                    }
                    placeholder="https://.../legenda.vtt"
                    className="w-full px-2.5 py-1.5 bg-[#111318] border border-white/10 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="sm:col-span-3 space-y-1">
                  <label className="block text-[11px] text-neutral-400">
                    Descrição do episódio (opcional)
                  </label>
                  <input
                    type="text"
                    maxLength={1200}
                    value={row.description}
                    onChange={(e) =>
                      updateRow(row.localId, { description: e.target.value })
                    }
                    placeholder="Resumo curto do episódio..."
                    className="w-full px-2.5 py-1.5 bg-[#111318] border border-white/10 rounded-lg text-xs text-white"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addNextEpisode}
        className="w-full py-2.5 px-3 rounded-lg border border-dashed border-white/20 hover:border-white/40 hover:bg-white/[0.03] text-xs font-medium text-neutral-200 inline-flex items-center justify-center gap-1.5 transition-colors"
      >
        <Plus className="w-3.5 h-3.5 text-[#FB7185]" />
        <span>
          Adicionar Episódio{' '}
          {rows.reduce((max, r) => Math.max(max, Number(r.episodeNumber) || 0), 0) + 1}
        </span>
      </button>
    </div>
  );
};

export const CatalogSeriesManager: React.FC<CatalogSeriesManagerProps> = ({
  currentAdmin,
  categories,
  seriesList,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [selectedSeries, setSelectedSeries] = useState<Series | null>(null);
  const [pendingSeriesId, setPendingSeriesId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Series modal (Create includes Seasons + Episode-by-episode Builder)
  const [seriesModalOpen, setSeriesModalOpen] = useState(false);
  const [editingSeriesId, setEditingSeriesId] = useState<string | undefined>(undefined);
  const [sTitle, setSTitle] = useState('');
  const [sSynopsis, setSSynopsis] = useState('');
  const [sPosterUrl, setSPosterUrl] = useState('');
  const [sBannerUrl, setSBannerUrl] = useState('');
  const [sCategoryId, setSCategoryId] = useState('');
  const [sYear, setSYear] = useState(2026);
  const [sAgeRating, setSAgeRating] = useState<AgeRating>('14');
  const [sLanguage, setSLanguage] = useState('Português / Legendado');
  const [sStatus, setSStatus] = useState<PublishStatus>('published');
  const [sFeatured, setSFeatured] = useState(false);
  const [sTrailerProvider, setSTrailerProvider] = useState<MediaProviderType>('google_drive');
  const [sRawTrailerLink, setSRawTrailerLink] = useState('');
  const [sExistingTrailerExists, setSExistingTrailerExists] = useState(false);
  const [loadingSeriesTrailer, setLoadingSeriesTrailer] = useState(false);
  const [draftSeasons, setDraftSeasons] = useState<SeasonDraftBlock[]>([
    createSeasonDraftBlock(1),
  ]);

  // "Inserir Nova Temporada" modal (on existing series: season info + episode links)
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [seasonTitle, setSeasonTitle] = useState('Temporada 1');
  const [seasonCustomTitle, setSeasonCustomTitle] = useState(false);
  const [seasonSynopsis, setSeasonSynopsis] = useState('');
  const [seasonStatus, setSeasonStatus] = useState<PublishStatus>('published');
  const [newSeasonEpisodeRows, setNewSeasonEpisodeRows] = useState<EpisodeDraftRow[]>([
    createEpisodeDraftRow(1),
  ]);

  // Batch add episodes modal for an existing season
  const [batchEpisodesModalOpen, setBatchEpisodesModalOpen] = useState(false);
  const [batchEpisodeRows, setBatchEpisodeRows] = useState<EpisodeDraftRow[]>([
    createEpisodeDraftRow(1),
  ]);

  // Single episode modal (edit existing episode or add individual with full detail)
  const [episodeModalOpen, setEpisodeModalOpen] = useState(false);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | undefined>(undefined);
  const [epNumber, setEpNumber] = useState(1);
  const [epSortOrder, setEpSortOrder] = useState(1);
  const [epTitle, setEpTitle] = useState('');
  const [epDescription, setEpDescription] = useState('');
  const [epDuration, setEpDuration] = useState(45);
  const [epThumbUrl, setEpThumbUrl] = useState('');
  const [epSubtitlesLabel, setEpSubtitlesLabel] = useState('PT-BR, EN');
  const [epStatus, setEpStatus] = useState<PublishStatus>('published');

  // Episode media source
  const [provider, setProvider] = useState<MediaProviderType>('google_drive');
  const [rawVideoLink, setRawVideoLink] = useState('');
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [qualityLabel, setQualityLabel] = useState('1080p Full HD');
  const [existingSourceExists, setExistingSourceExists] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);

  const detectedDriveId = useMemo(
    () => (provider === 'google_drive' ? extractDriveFileId(rawVideoLink) : ''),
    [provider, rawVideoLink]
  );

  const detectedSeriesTrailerId = useMemo(() => {
    if (sTrailerProvider === 'google_drive') return extractDriveFileId(sRawTrailerLink);
    if (sTrailerProvider === 'youtube') return extractYouTubeVideoId(sRawTrailerLink);
    return '';
  }, [sTrailerProvider, sRawTrailerLink]);

  useEffect(() => {
    if (!pendingSeriesId) return;
    const match = seriesList.find((s) => s.id === pendingSeriesId);
    if (match) {
      setSelectedSeries(match);
      setPendingSeriesId(null);
    }
  }, [pendingSeriesId, seriesList]);

  useEffect(() => {
    if (!selectedSeries) {
      setSeasons([]);
      setEpisodes([]);
      setSelectedSeasonId('');
      return;
    }

    const unsubSeasons = subscribeSeasonsBySeries(
      selectedSeries.id,
      true,
      (items) => {
        setSeasons(items);
        setSelectedSeasonId((prev) =>
          items.some((s) => s.id === prev) ? prev : items[0]?.id || ''
        );
      },
      (err) => onNotify('error', err.message)
    );

    const unsubEpisodes = subscribeEpisodesBySeries(
      selectedSeries.id,
      true,
      (items) => setEpisodes(items),
      (err) => onNotify('error', err.message)
    );

    return () => {
      unsubSeasons();
      unsubEpisodes();
    };
  }, [selectedSeries, onNotify]);

  const filteredSeries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return seriesList.filter(
      (s) => !q || s.title.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)
    );
  }, [seriesList, search]);

  const activeSeason = seasons.find((s) => s.id === selectedSeasonId) ?? null;

  const episodesInSelectedSeason = useMemo(
    () => episodes.filter((ep) => ep.seasonId === selectedSeasonId),
    [episodes, selectedSeasonId]
  );

  const openNewSeriesModal = () => {
    setEditingSeriesId(undefined);
    setSTitle('');
    setSSynopsis('');
    setSPosterUrl('');
    setSBannerUrl('');
    setSCategoryId(categories[0]?.id || '');
    setSYear(2026);
    setSAgeRating('14');
    setSLanguage('Português / Legendado');
    setSStatus('published');
    setSFeatured(false);
    setSTrailerProvider('google_drive');
    setSRawTrailerLink('');
    setSExistingTrailerExists(false);
    setDraftSeasons([createSeasonDraftBlock(1)]);
    setSeriesModalOpen(true);
  };

  const openEditSeriesModal = async (series: Series) => {
    setEditingSeriesId(series.id);
    setSTitle(series.title);
    setSSynopsis(series.synopsis);
    setSPosterUrl(series.posterUrl);
    setSBannerUrl(series.bannerUrl);
    setSCategoryId(series.categoryId);
    setSYear(series.releaseYear);
    setSAgeRating(series.ageRating);
    setSLanguage(series.language);
    setSStatus(series.status);
    setSFeatured(series.featured);
    setSTrailerProvider('google_drive');
    setSRawTrailerLink('');
    setSExistingTrailerExists(false);
    setSeriesModalOpen(true);

    setLoadingSeriesTrailer(true);
    try {
      const trailer = await getMediaSourceForAdmin(`trl_${series.id}`);
      if (trailer) {
        setSTrailerProvider(trailer.provider);
        setSRawTrailerLink(trailer.sourceUrl || trailer.driveFileId);
        setSExistingTrailerExists(true);
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Erro ao carregar o link do trailer da série.'
      );
    } finally {
      setLoadingSeriesTrailer(false);
    }
  };

  const updateDraftSeason = (localId: string, patch: Partial<SeasonDraftBlock>) => {
    setDraftSeasons((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s))
    );
  };

  const addDraftSeason = () => {
    setDraftSeasons((prev) => {
      const maxNum = prev.reduce((max, s) => Math.max(max, Number(s.seasonNumber) || 0), 0);
      return [...prev, createSeasonDraftBlock(maxNum + 1)];
    });
  };

  const removeDraftSeason = (localId: string) => {
    setDraftSeasons((prev) => prev.filter((s) => s.localId !== localId));
  };

  const handleSaveSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cat = categories.find((c) => c.id === sCategoryId);
      const seriesPayload = {
        id: editingSeriesId,
        title: sTitle,
        synopsis: sSynopsis,
        posterUrl: sPosterUrl,
        bannerUrl: sBannerUrl,
        categoryId: sCategoryId,
        genre: cat?.name || 'Geral',
        releaseYear: Number(sYear),
        ageRating: sAgeRating,
        language: sLanguage,
        status: sStatus,
        featured: sFeatured,
      };
      const trailerPayload = {
        provider: sTrailerProvider,
        rawTrailerLinkOrId: sRawTrailerLink,
        existingTrailerExists: sExistingTrailerExists,
      };

      if (editingSeriesId) {
        await saveSeries(currentAdmin, seriesPayload, trailerPayload);
        setSeriesModalOpen(false);
        onNotify('success', 'Dados da série atualizados.');
      } else {
        const result = await saveSeriesWithSeasonsAndEpisodes(
          currentAdmin,
          seriesPayload,
          trailerPayload,
          toDraftSeasonInputs(draftSeasons)
        );
        setSeriesModalOpen(false);
        setPendingSeriesId(result.seriesId);
        onNotify(
          'success',
          `Série salva com ${result.seasonCount} temporada(s) e ${result.episodeCount} episódio(s).`
        );
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao salvar série.');
    } finally {
      setSubmitting(false);
    }
  };

  const openNewSeasonModal = () => {
    const nextNum =
      seasons.reduce((max, s) => Math.max(max, s.seasonNumber), 0) + 1;
    setSeasonNumber(nextNum);
    setSeasonTitle(`Temporada ${nextNum}`);
    setSeasonCustomTitle(false);
    setSeasonSynopsis('');
    setSeasonStatus('published');
    setNewSeasonEpisodeRows([createEpisodeDraftRow(1)]);
    setSeasonModalOpen(true);
  };

  const handleSaveNewSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeries) return;
    setSubmitting(true);
    try {
      const { createdSeasonIds, episodeCount } = await addSeasonsAndEpisodesToSeries(
        currentAdmin,
        selectedSeries.id,
        [
          {
            seasonNumber: Number(seasonNumber),
            title: seasonTitle,
            synopsis: seasonSynopsis,
            status: seasonStatus,
            episodes: toDraftEpisodeInputs(newSeasonEpisodeRows, seasonStatus),
          },
        ]
      );
      if (createdSeasonIds[0]) {
        setSelectedSeasonId(createdSeasonIds[0]);
      }
      setSeasonModalOpen(false);
      onNotify(
        'success',
        `${seasonTitle || `Temporada ${seasonNumber}`} inserida com ${episodeCount} episódio(s) vinculado(s) à série.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao criar temporada.');
    } finally {
      setSubmitting(false);
    }
  };

  const openBatchEpisodesModal = () => {
    if (!activeSeason) return;
    const nextEpNum =
      episodesInSelectedSeason.reduce((max, ep) => Math.max(max, ep.episodeNumber), 0) + 1;
    setBatchEpisodeRows([createEpisodeDraftRow(nextEpNum)]);
    setBatchEpisodesModalOpen(true);
  };

  const handleSaveBatchEpisodes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeries || !activeSeason) return;
    setSubmitting(true);
    try {
      const count = await saveEpisodesBatchWithMedia(
        currentAdmin,
        selectedSeries.id,
        activeSeason.id,
        activeSeason.seasonNumber,
        toDraftEpisodeInputs(batchEpisodeRows, 'published')
      );
      setBatchEpisodesModalOpen(false);
      onNotify(
        'success',
        `${count} episódio(s) salvo(s) na ${activeSeason.title}.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao salvar episódios.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditEpisodeModal = async (ep: Episode) => {
    setEditingEpisodeId(ep.id);
    setEpNumber(ep.episodeNumber);
    setEpSortOrder(ep.sortOrder);
    setEpTitle(ep.title);
    setEpDescription(ep.description);
    setEpDuration(ep.durationMinutes);
    setEpThumbUrl(ep.thumbnailUrl);
    setEpSubtitlesLabel(ep.subtitlesLabel);
    setEpStatus(ep.status);
    setProvider('google_drive');
    setRawVideoLink('');
    setSubtitleUrl('');
    setQualityLabel('1080p Full HD');
    setExistingSourceExists(false);
    setEpisodeModalOpen(true);

    setLoadingMedia(true);
    try {
      const media = await getMediaSourceForAdmin(ep.id);
      if (media) {
        setProvider(media.provider);
        setRawVideoLink(media.sourceUrl || media.driveFileId);
        setSubtitleUrl(media.subtitleUrl);
        setQualityLabel(media.qualityLabel || '1080p Full HD');
        setExistingSourceExists(true);
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Erro ao carregar link do episódio.'
      );
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleSaveEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeries || !activeSeason) return;
    setSubmitting(true);
    try {
      await saveEpisodeWithMedia(
        currentAdmin,
        {
          id: editingEpisodeId,
          seriesId: selectedSeries.id,
          seasonId: activeSeason.id,
          seasonNumber: activeSeason.seasonNumber,
          episodeNumber: Number(epNumber),
          sortOrder: Number(epSortOrder),
          title: epTitle,
          description: epDescription,
          durationMinutes: Number(epDuration),
          thumbnailUrl: epThumbUrl,
          subtitlesLabel: epSubtitlesLabel,
          status: epStatus,
        },
        {
          provider,
          rawVideoLinkOrId: rawVideoLink,
          subtitleUrl,
          qualityLabel,
          existingSourceExists,
        }
      );
      setEpisodeModalOpen(false);
      onNotify('success', 'Episódio e link de vídeo salvos com sucesso.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao salvar episódio.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!selectedSeries ? (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar série por título ou gênero..."
                className="w-full pl-10 pr-4 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500"
              />
            </div>

            <button
              type="button"
              disabled={categories.length === 0}
              onClick={openNewSeriesModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Cadastrar Série</span>
            </button>
          </div>

          <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/8 text-xs font-medium text-neutral-400">
                    <th className="py-3.5 px-4">Série</th>
                    <th className="py-3.5 px-4">Categoria</th>
                    <th className="py-3.5 px-4">Ano</th>
                    <th className="py-3.5 px-4">Publicação</th>
                    <th className="py-3.5 px-4 text-right">Gerenciamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 text-sm">
                  {filteredSeries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-neutral-400">
                        {categories.length === 0
                          ? 'Crie pelo menos uma categoria na aba "Filmes & Links" antes de cadastrar séries.'
                          : 'Nenhuma série cadastrada ainda. Clique em "Cadastrar Série" para adicionar a série com temporadas e episódios.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSeries.map((series) => (
                      <tr key={series.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            {series.posterUrl ? (
                              <img
                                src={series.posterUrl}
                                alt={series.title}
                                referrerPolicy="no-referrer"
                                className="w-9 h-12 rounded object-cover bg-[#090A0D] shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-12 rounded bg-[#090A0D] border border-white/10 flex items-center justify-center text-neutral-500 shrink-0">
                                <Tv className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-white truncate max-w-[240px]">
                                {series.title}
                              </p>
                              <p className="text-xs text-neutral-500">
                                Classificação {series.ageRating}
                                {series.featured ? ' · Destaque' : ''}
                                {series.hasTrailer ? ' · Trailer' : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-neutral-300">{series.genre}</td>
                        <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums">
                          {series.releaseYear}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                              series.status === 'published'
                                ? 'text-[#4ADE80] border-[#16A34A]/30 bg-[#16A34A]/10'
                                : 'text-neutral-300 border-white/15 bg-white/5'
                            }`}
                          >
                            {series.status === 'published' ? 'Publicado' : 'Rascunho'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedSeries(series)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#181B22] hover:bg-[#222630] border border-white/10 text-white"
                            >
                              <Layers className="w-3.5 h-3.5 text-[#FB7185]" />
                              <span>Temporadas &amp; Episódios</span>
                            </button>
                            <button
                              type="button"
                              title="Editar série"
                              onClick={() => openEditSeriesModal(series)}
                              className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-white/10"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Excluir série"
                              onClick={() => deleteSeries(currentAdmin, series)}
                              className="p-1.5 rounded-md text-neutral-400 hover:text-[#F87171] hover:bg-[#DC2626]/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Drill-down: Seasons & Episodes of Selected Series */
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-[#111318] border border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setSelectedSeries(null)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#090A0D] hover:bg-[#181B22] text-white"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar</span>
              </button>
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  {selectedSeries.title}
                </h2>
                <p className="text-xs text-neutral-400 font-mono tabular-nums">
                  {seasons.length} temporada(s) · {episodes.length} episódio(s) vinculados a esta série
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openNewSeasonModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#181B22] hover:bg-[#222630] text-white whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-[#FB7185]" />
                <span>Inserir Nova Temporada</span>
              </button>
              <button
                type="button"
                disabled={!activeSeason}
                onClick={openBatchEpisodesModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Episódios + Links</span>
              </button>
            </div>
          </div>

          {/* Season Tabs */}
          {seasons.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-center space-y-3">
              <p className="text-sm text-neutral-400">
                Nenhuma temporada criada para esta série ainda.
              </p>
              <button
                type="button"
                onClick={openNewSeasonModal}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                Inserir Temporada 1 + Episódios
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111318] border border-white/8 rounded-lg">
                  {seasons.map((season) => (
                    <button
                      key={season.id}
                      type="button"
                      onClick={() => setSelectedSeasonId(season.id)}
                      className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        selectedSeasonId === season.id
                          ? 'bg-[#1F242D] text-white'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {season.title}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={openNewSeasonModal}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-[#FB7185] hover:bg-white/5 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova Temporada</span>
                  </button>
                </div>

                {activeSeason && (
                  <button
                    type="button"
                    onClick={() => deleteSeason(currentAdmin, activeSeason)}
                    className="text-xs text-neutral-400 hover:text-[#F87171]"
                  >
                    Excluir {activeSeason.title}
                  </button>
                )}
              </div>

              {/* Episodes Table */}
              <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/8 text-xs font-medium text-neutral-400">
                        <th className="py-3.5 px-4">Ep.</th>
                        <th className="py-3.5 px-4">Título</th>
                        <th className="py-3.5 px-4">Duração</th>
                        <th className="py-3.5 px-4">Fonte de Vídeo</th>
                        <th className="py-3.5 px-4">Publicação</th>
                        <th className="py-3.5 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 text-sm">
                      {episodesInSelectedSeason.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-neutral-400">
                            Nenhum episódio cadastrado nesta temporada. Clique em &quot;Adicionar Episódios + Links&quot;.
                          </td>
                        </tr>
                      ) : (
                        episodesInSelectedSeason.map((ep) => (
                          <tr key={ep.id} className="hover:bg-white/[0.02]">
                            <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                              T{ep.seasonNumber}E{String(ep.episodeNumber).padStart(2, '0')}
                            </td>
                            <td className="py-3 px-4 font-medium text-white">{ep.title}</td>
                            <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                              {ep.durationMinutes} min
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {ep.hasVideoSource ? (
                                <span className="inline-flex items-center gap-1.5 text-xs text-[#4ADE80]">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Vídeo vinculado</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-xs text-[#FBBF24]">
                                  <Link2 className="w-3.5 h-3.5" />
                                  <span>Sem link</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${
                                  ep.status === 'published'
                                    ? 'text-[#4ADE80] border-[#16A34A]/30 bg-[#16A34A]/10'
                                    : 'text-neutral-300 border-white/15 bg-white/5'
                                }`}
                              >
                                {ep.status === 'published' ? 'Publicado' : 'Rascunho'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  title="Editar episódio e link de vídeo"
                                  onClick={() => openEditEpisodeModal(ep)}
                                  className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-white/10"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title="Excluir episódio"
                                  onClick={() => deleteEpisodeWithMedia(currentAdmin, ep)}
                                  className="p-1.5 rounded-md text-neutral-400 hover:text-[#F87171] hover:bg-[#DC2626]/10"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal: Cadastrar / Editar Série (+ Temporadas e Episódios no Cadastro) */}
      {seriesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                {editingSeriesId ? 'Editar Série' : 'Cadastrar Nova Série'}
              </h3>
              <button
                type="button"
                onClick={() => setSeriesModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSeries} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-xs font-medium text-neutral-300">
                    Nome / Título da Série
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={sTitle}
                    onChange={(e) => setSTitle(e.target.value)}
                    placeholder="Ex: Cidade Oculta"
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-xs font-medium text-neutral-300">Sinopse</label>
                  <textarea
                    required
                    minLength={4}
                    maxLength={1500}
                    rows={3}
                    value={sSynopsis}
                    onChange={(e) => setSSynopsis(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Categoria</label>
                  <select
                    required
                    value={sCategoryId}
                    onChange={(e) => setSCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Ano</label>
                    <input
                      type="number"
                      min={1900}
                      max={2100}
                      required
                      value={sYear}
                      onChange={(e) => setSYear(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Classif.</label>
                    <select
                      value={sAgeRating}
                      onChange={(e) => setSAgeRating(e.target.value as AgeRating)}
                      className="w-full px-2.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                    >
                      {(['L', '10', '12', '14', '16', '18'] as AgeRating[]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Idioma</label>
                  <input
                    type="text"
                    required
                    maxLength={60}
                    value={sLanguage}
                    onChange={(e) => setSLanguage(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Publicação</label>
                  <select
                    value={sStatus}
                    onChange={(e) => setSStatus(e.target.value as PublishStatus)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    <option value="published">Publicado</option>
                    <option value="draft">Rascunho</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    URL da Capa (Pôster 3:4)
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={sPosterUrl}
                    onChange={(e) => setSPosterUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    URL do Banner (16:9 — destaque inicial)
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={sBannerUrl}
                    onChange={(e) => setSBannerUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
              </div>

              {/* Dedicated Series Teaser / Trailer Section */}
              <div className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Video className="w-4 h-4 text-[#FB7185]" />
                    <span>Teaser / Trailer da Série (opcional)</span>
                  </div>
                  {loadingSeriesTrailer ? (
                    <span className="text-xs text-neutral-400">Carregando vínculo...</span>
                  ) : (
                    <span className="text-xs text-neutral-500">Exibido no banner inicial</span>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Origem do trailer
                    </label>
                    <select
                      value={sTrailerProvider}
                      onChange={(e) => setSTrailerProvider(e.target.value as MediaProviderType)}
                      className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                    >
                      <option value="google_drive">Google Drive (Link ou ID)</option>
                      <option value="gcs_hls">MP4 / HLS (.mp4 / .m3u8)</option>
                      <option value="youtube">YouTube (Link do trailer)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="block text-xs font-medium text-neutral-300">
                      Link do teaser ou trailer
                    </label>
                    <input
                      type="text"
                      maxLength={1000}
                      value={sRawTrailerLink}
                      onChange={(e) => setSRawTrailerLink(e.target.value)}
                      placeholder={
                        sTrailerProvider === 'youtube'
                          ? 'https://www.youtube.com/watch?v=...'
                          : sTrailerProvider === 'google_drive'
                            ? 'https://drive.google.com/file/d/.../view'
                            : 'https://cdn.seudominio.com/trailer.mp4'
                      }
                      className="w-full px-3.5 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white font-mono"
                    />
                  </div>
                </div>

                {sRawTrailerLink.trim() && sTrailerProvider !== 'gcs_hls' && (
                  <p className="text-xs">
                    {detectedSeriesTrailerId ? (
                      <span className="text-[#4ADE80]">
                        {sTrailerProvider === 'youtube'
                          ? 'Vídeo do YouTube identificado: '
                          : 'ID do Google Drive identificado: '}
                        <code className="font-mono">{detectedSeriesTrailerId}</code>
                      </span>
                    ) : (
                      <span className="text-[#F87171]">
                        {sTrailerProvider === 'youtube'
                          ? 'Link do YouTube não reconhecido.'
                          : 'ID do Google Drive não identificado neste link.'}
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Integrated Seasons + Episode-by-Episode Builder on New Series */}
              {!editingSeriesId && (
                <div className="pt-2 border-t border-white/10 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-white">
                        Temporadas &amp; Episódios desta Série
                      </h4>
                      <p className="text-xs text-neutral-400">
                        Cadastre a Temporada 1 com cada episódio e seu link, e insira novas temporadas vinculadas à mesma série.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={addDraftSeason}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#181B22] hover:bg-[#222630] text-white whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#FB7185]" />
                      <span>Inserir Nova Temporada</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {draftSeasons.map((seasonBlock) => (
                      <div
                        key={seasonBlock.localId}
                        className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3"
                      >
                        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-white/8">
                          <div className="flex flex-wrap items-end gap-3 flex-1">
                            <div className="w-28 space-y-1">
                              <label className="block text-[11px] font-medium text-neutral-300">
                                Temporada Nº
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                required
                                value={seasonBlock.seasonNumber}
                                onChange={(e) => {
                                  const nextNum = Number(e.target.value);
                                  updateDraftSeason(seasonBlock.localId, {
                                    seasonNumber: nextNum,
                                    title: seasonBlock.customTitle
                                      ? seasonBlock.title
                                      : `Temporada ${nextNum || 1}`,
                                  });
                                }}
                                className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white font-mono tabular-nums"
                              />
                            </div>
                            <div className="flex-1 min-w-[180px] space-y-1">
                              <label className="block text-[11px] font-medium text-neutral-300">
                                Nome da Temporada
                              </label>
                              <input
                                type="text"
                                maxLength={120}
                                required
                                value={seasonBlock.title}
                                onChange={(e) =>
                                  updateDraftSeason(seasonBlock.localId, {
                                    title: e.target.value,
                                    customTitle: true,
                                  })
                                }
                                className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-xs text-white"
                              />
                            </div>
                          </div>

                          {draftSeasons.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeDraftSeason(seasonBlock.localId)}
                              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs text-neutral-400 hover:text-[#F87171]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remover temporada</span>
                            </button>
                          )}
                        </div>

                        <EpisodeRowsBuilder
                          rows={seasonBlock.episodes}
                          onChange={(nextRows) =>
                            updateDraftSeason(seasonBlock.localId, { episodes: nextRows })
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={addDraftSeason}
                    className="w-full py-2.5 px-4 rounded-lg border border-white/15 bg-[#181B22] hover:bg-[#222630] text-xs font-medium text-white inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-[#FB7185]" />
                    <span>
                      Inserir Nova Temporada (Temporada{' '}
                      {draftSeasons.reduce(
                        (max, s) => Math.max(max, Number(s.seasonNumber) || 0),
                        0
                      ) + 1}
                      )
                    </span>
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sFeatured}
                    onChange={(e) => setSFeatured(e.target.checked)}
                    className="rounded border-white/20 bg-[#090A0D]"
                  />
                  <span>Destacar no topo (mais recentes primeiro)</span>
                </label>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSeriesModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                  >
                    {submitting
                      ? 'Salvando...'
                      : editingSeriesId
                        ? 'Salvar série'
                        : 'Salvar série e temporadas'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Inserir Nova Temporada (+ Episódios e Links) em série existente */}
      {seasonModalOpen && selectedSeries && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-white">
                  Inserir Nova Temporada — {selectedSeries.title}
                </h3>
                <p className="text-xs text-neutral-400">
                  Esta temporada ficará vinculada à mesma série com todos os episódios e links cadastrados abaixo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSeasonModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewSeason} className="space-y-4">
              <div className="grid sm:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Número da temporada
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={seasonNumber}
                    onChange={(e) => {
                      const nextNum = Number(e.target.value);
                      setSeasonNumber(nextNum);
                      if (!seasonCustomTitle) {
                        setSeasonTitle(`Temporada ${nextNum || 1}`);
                      }
                    }}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Nome da temporada
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={seasonTitle}
                    onChange={(e) => {
                      setSeasonTitle(e.target.value);
                      setSeasonCustomTitle(true);
                    }}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Status</label>
                  <select
                    value={seasonStatus}
                    onChange={(e) => setSeasonStatus(e.target.value as PublishStatus)}
                    className="w-full px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    <option value="published">Publicado</option>
                    <option value="draft">Rascunho</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Sinopse da temporada (opcional)
                </label>
                <textarea
                  rows={2}
                  maxLength={800}
                  value={seasonSynopsis}
                  onChange={(e) => setSeasonSynopsis(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>

              <div className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-white">
                    Episódios da {seasonTitle || `Temporada ${seasonNumber}`}
                  </h4>
                  <p className="text-[11px] text-neutral-400">
                    Cole o link de cada episódio em sequência até terminar esta temporada.
                  </p>
                </div>

                <EpisodeRowsBuilder
                  rows={newSeasonEpisodeRows}
                  onChange={setNewSeasonEpisodeRows}
                />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setSeasonModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                >
                  {submitting
                    ? 'Salvando temporada...'
                    : `Salvar ${seasonTitle || `Temporada ${seasonNumber}`}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Episódios em Sequência na temporada selecionada */}
      {batchEpisodesModalOpen && activeSeason && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold text-white">
                  Adicionar Episódios — {activeSeason.title}
                </h3>
                <p className="text-xs text-neutral-400">
                  Adicione quantos episódios quiser em sequência e cole o link de cada um.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchEpisodesModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBatchEpisodes} className="space-y-4">
              <EpisodeRowsBuilder
                rows={batchEpisodeRows}
                onChange={setBatchEpisodeRows}
              />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBatchEpisodesModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                >
                  {submitting
                    ? 'Salvando...'
                    : `Salvar ${batchEpisodeRows.length} episódio(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Episódio Individual + Link do Vídeo */}
      {episodeModalOpen && activeSeason && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                {editingEpisodeId ? 'Editar Episódio' : 'Novo Episódio'} — {activeSeason.title}
              </h3>
              <button
                type="button"
                onClick={() => setEpisodeModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEpisode} className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Número do episódio
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    required
                    value={epNumber}
                    onChange={(e) => setEpNumber(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Ordem de reprodução
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={epSortOrder}
                    onChange={(e) => setEpSortOrder(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Duração (minutos)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    required
                    value={epDuration}
                    onChange={(e) => setEpDuration(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Título do episódio
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={epTitle}
                  onChange={(e) => setEpTitle(e.target.value)}
                  placeholder={`Episódio ${epNumber}`}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Descrição (opcional)
                </label>
                <textarea
                  maxLength={1200}
                  rows={2}
                  value={epDescription}
                  onChange={(e) => setEpDescription(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    URL da Capa do Episódio
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={epThumbUrl}
                    onChange={(e) => setEpThumbUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Legendas</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={epSubtitlesLabel}
                    onChange={(e) => setEpSubtitlesLabel(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
              </div>

              {/* Episode Google Drive / Video Link Section */}
              <div className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Video className="w-4 h-4 text-[#FB7185]" />
                    <span>Link do Episódio (Google Drive / CDN)</span>
                  </div>
                  {loadingMedia && (
                    <span className="text-xs text-neutral-400">Carregando vínculo...</span>
                  )}
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Provedor</label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as MediaProviderType)}
                      className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                    >
                      <option value="google_drive">Google Drive (Link ou ID)</option>
                      <option value="gcs_hls">Cloud Storage / HLS (.m3u8 / .mp4)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="block text-xs font-medium text-neutral-300">
                      Link ou ID do arquivo de vídeo
                    </label>
                    <input
                      type="text"
                      maxLength={1000}
                      value={rawVideoLink}
                      onChange={(e) => setRawVideoLink(e.target.value)}
                      placeholder="https://drive.google.com/file/d/1AbC.../view ou ID"
                      className="w-full px-3.5 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white font-mono"
                    />
                  </div>
                </div>

                {provider === 'google_drive' && rawVideoLink.trim() && (
                  <p className="text-xs">
                    {detectedDriveId ? (
                      <span className="text-[#4ADE80]">
                        ID do Google Drive extraído:{' '}
                        <code className="font-mono">{detectedDriveId}</code>
                      </span>
                    ) : (
                      <span className="text-[#F87171]">
                        Link do Google Drive inválido — verifique o endereço colado.
                      </span>
                    )}
                  </p>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    maxLength={40}
                    value={qualityLabel}
                    onChange={(e) => setQualityLabel(e.target.value)}
                    placeholder="Qualidade (ex: 1080p)"
                    className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                  />
                  <input
                    type="url"
                    maxLength={1000}
                    value={subtitleUrl}
                    onChange={(e) => setSubtitleUrl(e.target.value)}
                    placeholder="Link da legenda .vtt (opcional)"
                    className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <select
                  value={epStatus}
                  onChange={(e) => setEpStatus(e.target.value as PublishStatus)}
                  className="px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-xs text-white"
                >
                  <option value="published">Publicado</option>
                  <option value="draft">Rascunho</option>
                </select>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEpisodeModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                  >
                    {submitting ? 'Salvando...' : 'Salvar episódio'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
