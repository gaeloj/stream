import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Film,
  FolderPlus,
  Link2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  deleteCategory,
  deleteMovieWithMedia,
  getMediaSourceForAdmin,
  saveCategory,
  saveMovieWithMedia,
  seedDefaultCategories,
} from '../../services/catalogService';
import type {
  AgeRating,
  Category,
  MediaProviderType,
  Movie,
  PublishStatus,
  UserAccount,
} from '../../types/domain';
import { extractDriveFileId, extractYouTubeVideoId } from '../../utils/mediaLinks';

interface CatalogMoviesManagerProps {
  currentAdmin: UserAccount;
  categories: Category[];
  movies: Movie[];
  onNotify: (type: 'success' | 'error', text: string) => void;
  openNewTrigger?: number;
}

export const CatalogMoviesManager: React.FC<CatalogMoviesManagerProps> = ({
  currentAdmin,
  categories,
  movies,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PublishStatus>('all');
  const [newCatName, setNewCatName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Movie modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMovieId, setEditingMovieId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [releaseYear, setReleaseYear] = useState(2026);
  const [durationMinutes, setDurationMinutes] = useState(110);
  const [ageRating, setAgeRating] = useState<AgeRating>('14');
  const [language, setLanguage] = useState('Português / Legendado');
  const [subtitlesLabel, setSubtitlesLabel] = useState('PT-BR, EN');
  const [status, setStatus] = useState<PublishStatus>('published');
  const [featured, setFeatured] = useState(false);

  // Private media source fields
  const [provider, setProvider] = useState<MediaProviderType>('google_drive');
  const [rawVideoLink, setRawVideoLink] = useState('');
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [qualityLabel, setQualityLabel] = useState('1080p Full HD');
  const [existingSourceExists, setExistingSourceExists] = useState(false);

  // Trailer / Teaser source fields
  const [trailerProvider, setTrailerProvider] = useState<MediaProviderType>('google_drive');
  const [rawTrailerLink, setRawTrailerLink] = useState('');
  const [existingTrailerExists, setExistingTrailerExists] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);

  const detectedDriveId = useMemo(
    () => (provider === 'google_drive' ? extractDriveFileId(rawVideoLink) : ''),
    [provider, rawVideoLink]
  );

  const detectedTrailerId = useMemo(() => {
    if (trailerProvider === 'google_drive') return extractDriveFileId(rawTrailerLink);
    if (trailerProvider === 'youtube') return extractYouTubeVideoId(rawTrailerLink);
    return '';
  }, [trailerProvider, rawTrailerLink]);

  const filteredMovies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return movies.filter((m) => {
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchSearch =
        !q || m.title.toLowerCase().includes(q) || m.genre.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [movies, search, statusFilter]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    setSubmitting(true);
    try {
      await saveCategory(currentAdmin, {
        name: newCatName,
        sortOrder: categories.length + 1,
        isActive: true,
      });
      setNewCatName('');
      onNotify('success', 'Categoria adicionada ao catálogo.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao criar categoria.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSeedCategories = async () => {
    setSubmitting(true);
    try {
      await seedDefaultCategories(currentAdmin);
      onNotify('success', 'Categorias padrão criadas com sucesso.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao criar categorias.');
    } finally {
      setSubmitting(false);
    }
  };

  const openNewMovieModal = () => {
    setEditingMovieId(undefined);
    setTitle('');
    setSynopsis('');
    setPosterUrl('');
    setBannerUrl('');
    setCategoryId(categories[0]?.id || '');
    setReleaseYear(2026);
    setDurationMinutes(110);
    setAgeRating('14');
    setLanguage('Português / Legendado');
    setSubtitlesLabel('PT-BR, EN');
    setStatus('published');
    setFeatured(false);
    setProvider('google_drive');
    setRawVideoLink('');
    setSubtitleUrl('');
    setQualityLabel('1080p Full HD');
    setExistingSourceExists(false);
    setTrailerProvider('google_drive');
    setRawTrailerLink('');
    setExistingTrailerExists(false);
    setModalOpen(true);
  };

  const openEditMovieModal = async (movie: Movie) => {
    setEditingMovieId(movie.id);
    setTitle(movie.title);
    setSynopsis(movie.synopsis);
    setPosterUrl(movie.posterUrl);
    setBannerUrl(movie.bannerUrl);
    setCategoryId(movie.categoryId);
    setReleaseYear(movie.releaseYear);
    setDurationMinutes(movie.durationMinutes);
    setAgeRating(movie.ageRating);
    setLanguage(movie.language);
    setSubtitlesLabel(movie.subtitlesLabel);
    setStatus(movie.status);
    setFeatured(movie.featured);
    setProvider('google_drive');
    setRawVideoLink('');
    setSubtitleUrl('');
    setQualityLabel('1080p Full HD');
    setExistingSourceExists(false);
    setTrailerProvider('google_drive');
    setRawTrailerLink('');
    setExistingTrailerExists(false);
    setModalOpen(true);

    setLoadingMedia(true);
    try {
      const [media, trailer] = await Promise.all([
        getMediaSourceForAdmin(movie.id),
        getMediaSourceForAdmin(`trl_${movie.id}`),
      ]);
      if (media) {
        setProvider(media.provider);
        setRawVideoLink(media.sourceUrl || media.driveFileId);
        setSubtitleUrl(media.subtitleUrl);
        setQualityLabel(media.qualityLabel || '1080p Full HD');
        setExistingSourceExists(true);
      }
      if (trailer) {
        setTrailerProvider(trailer.provider);
        setRawTrailerLink(trailer.sourceUrl || trailer.driveFileId);
        setExistingTrailerExists(true);
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Não foi possível carregar o link do vídeo.'
      );
    } finally {
      setLoadingMedia(false);
    }
  };

  const handleSaveMovie = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cat = categories.find((c) => c.id === categoryId);
      await saveMovieWithMedia(
        currentAdmin,
        {
          id: editingMovieId,
          title,
          synopsis,
          posterUrl,
          bannerUrl,
          categoryId,
          genre: cat?.name || 'Geral',
          releaseYear: Number(releaseYear),
          durationMinutes: Number(durationMinutes),
          ageRating,
          language,
          subtitlesLabel,
          status,
          featured,
        },
        {
          provider,
          rawVideoLinkOrId: rawVideoLink,
          subtitleUrl,
          qualityLabel,
          existingSourceExists,
        },
        {
          provider: trailerProvider,
          rawTrailerLinkOrId: rawTrailerLink,
          existingTrailerExists,
        }
      );
      setModalOpen(false);
      onNotify(
        'success',
        editingMovieId ? 'Filme e links de mídia atualizados.' : 'Filme cadastrado com sucesso.'
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao salvar filme.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMovie = async (movie: Movie) => {
    try {
      await deleteMovieWithMedia(currentAdmin, movie);
      onNotify('success', `Filme "${movie.title}" removido.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Erro ao remover filme.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Categories Management Bar */}
      <section className="p-5 rounded-xl bg-[#111318] border border-white/8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Categorias do Catálogo
            </h2>
            <p className="text-xs text-neutral-400">
              Cadastre gêneros para organizar filmes e séries na área do assinante.
            </p>
          </div>
          {categories.length === 0 && (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSeedCategories}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-white/15 bg-[#181B22] hover:bg-[#1F242D] text-white"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FB7185]" />
              <span>Criar categorias padrão</span>
            </button>
          )}
        </div>

        <form onSubmit={handleCreateCategory} className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            maxLength={60}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="Nova categoria (ex: Ficção Científica)"
            className="flex-1 min-w-[220px] max-w-sm px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500"
          />
          <button
            type="submit"
            disabled={submitting || !newCatName.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#181B22] hover:bg-[#222630] border border-white/10 text-white disabled:opacity-50"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Adicionar categoria</span>
          </button>
        </form>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#090A0D] border border-white/8 text-xs text-neutral-200"
              >
                <span>{cat.name}</span>
                <button
                  type="button"
                  title={`Excluir ${cat.name}`}
                  onClick={() => deleteCategory(currentAdmin, cat)}
                  className="text-neutral-500 hover:text-[#F87171]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Movies Toolbar */}
      <section className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar filme por título ou gênero..."
                className="w-full pl-10 pr-4 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#111318] border border-white/8 rounded-lg">
              {(['all', 'published', 'draft'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    statusFilter === st
                      ? 'bg-[#1F242D] text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {st === 'all' ? 'Todos' : st === 'published' ? 'Publicados' : 'Rascunhos'}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={categories.length === 0}
            onClick={openNewMovieModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Cadastrar Filme</span>
          </button>
        </div>

        {/* Movies Table */}
        <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/8 text-xs font-medium text-neutral-400">
                  <th className="py-3.5 px-4">Filme</th>
                  <th className="py-3.5 px-4">Categoria</th>
                  <th className="py-3.5 px-4">Ano / Duração</th>
                  <th className="py-3.5 px-4">Fonte de Vídeo</th>
                  <th className="py-3.5 px-4">Publicação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 text-sm">
                {filteredMovies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-neutral-400">
                      {categories.length === 0
                        ? 'Crie pelo menos uma categoria acima antes de cadastrar filmes.'
                        : 'Nenhum filme cadastrado ainda. Clique em "Cadastrar Filme" para inserir seu primeiro título e link do Google Drive.'}
                    </td>
                  </tr>
                ) : (
                  filteredMovies.map((movie) => (
                    <tr key={movie.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {movie.posterUrl ? (
                            <img
                              src={movie.posterUrl}
                              alt={movie.title}
                              referrerPolicy="no-referrer"
                              className="w-9 h-12 rounded object-cover bg-[#090A0D] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-12 rounded bg-[#090A0D] border border-white/10 flex items-center justify-center text-neutral-500 shrink-0">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-white truncate max-w-[240px]">
                              {movie.title}
                            </p>
                            <p className="text-xs text-neutral-500">
                              Classificação {movie.ageRating}
                              {movie.featured ? ' · Destaque' : ''}
                              {movie.hasTrailer ? ' · Trailer' : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-300">{movie.genre}</td>
                      <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                        {movie.releaseYear} · {movie.durationMinutes} min
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {movie.hasVideoSource ? (
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
                            movie.status === 'published'
                              ? 'text-[#4ADE80] border-[#16A34A]/30 bg-[#16A34A]/10'
                              : 'text-neutral-300 border-white/15 bg-white/5'
                          }`}
                        >
                          {movie.status === 'published' ? 'Publicado' : 'Rascunho'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title="Editar filme e link de vídeo"
                            onClick={() => openEditMovieModal(movie)}
                            className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-white/10"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Excluir filme"
                            onClick={() => handleDeleteMovie(movie)}
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
      </section>

      {/* Modal: Cadastrar / Editar Filme + Link do Vídeo */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                {editingMovieId ? 'Editar Filme e Link de Vídeo' : 'Cadastrar Novo Filme'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMovie} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="block text-xs font-medium text-neutral-300">Título</label>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Horizonte Vertical"
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
                    value={synopsis}
                    onChange={(e) => setSynopsis(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Categoria</label>
                  <select
                    required
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Ano</label>
                    <input
                      type="number"
                      min={1900}
                      max={2100}
                      required
                      value={releaseYear}
                      onChange={(e) => setReleaseYear(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Minutos</label>
                    <input
                      type="number"
                      min={1}
                      max={600}
                      required
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">Classif.</label>
                    <select
                      value={ageRating}
                      onChange={(e) => setAgeRating(e.target.value as AgeRating)}
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
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Legendas disponíveis
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={subtitlesLabel}
                    onChange={(e) => setSubtitlesLabel(e.target.value)}
                    placeholder="PT-BR, EN"
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    URL da Capa (Pôster 3:4)
                  </label>
                  <input
                    type="url"
                    maxLength={1000}
                    value={posterUrl}
                    onChange={(e) => setPosterUrl(e.target.value)}
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
                    value={bannerUrl}
                    onChange={(e) => setBannerUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
              </div>

              {/* Dedicated Google Drive / Video Link Vault Section */}
              <div className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Video className="w-4 h-4 text-[#FB7185]" />
                    <span>Link do Vídeo (Armazenamento Privado)</span>
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
                      {provider === 'google_drive'
                        ? 'Link de compartilhamento ou ID do arquivo no Google Drive'
                        : 'URL do arquivo de vídeo ou manifesto HLS'}
                    </label>
                    <input
                      type="text"
                      maxLength={1000}
                      value={rawVideoLink}
                      onChange={(e) => setRawVideoLink(e.target.value)}
                      placeholder={
                        provider === 'google_drive'
                          ? 'https://drive.google.com/file/d/1AbC.../view ou ID do arquivo'
                          : 'https://cdn.seudominio.com/filme/master.m3u8'
                      }
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
                        Não foi possível identificar o ID do arquivo do Google Drive neste link.
                      </span>
                    )}
                  </p>
                )}

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Qualidade padrão
                    </label>
                    <input
                      type="text"
                      maxLength={40}
                      value={qualityLabel}
                      onChange={(e) => setQualityLabel(e.target.value)}
                      placeholder="1080p Full HD"
                      className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Link da legenda (.vtt / .srt) opcional
                    </label>
                    <input
                      type="url"
                      maxLength={1000}
                      value={subtitleUrl}
                      onChange={(e) => setSubtitleUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white"
                    />
                  </div>
                </div>

                <p className="text-xs text-neutral-500">
                  O link e o ID do arquivo são gravados exclusivamente na coleção protegida{' '}
                  <code className="font-mono">mediaSources</code> (acesso restrito ao administrador e ao proxy de entrega).
                </p>
              </div>

              {/* Dedicated Teaser / Trailer Section */}
              <div className="p-4 rounded-xl bg-[#090A0D] border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Film className="w-4 h-4 text-[#FB7185]" />
                    <span>Teaser / Trailer do Filme (opcional)</span>
                  </div>
                  <span className="text-xs text-neutral-500">Exibido no banner inicial</span>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Origem do trailer
                    </label>
                    <select
                      value={trailerProvider}
                      onChange={(e) => setTrailerProvider(e.target.value as MediaProviderType)}
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
                      value={rawTrailerLink}
                      onChange={(e) => setRawTrailerLink(e.target.value)}
                      placeholder={
                        trailerProvider === 'youtube'
                          ? 'https://www.youtube.com/watch?v=...'
                          : trailerProvider === 'google_drive'
                            ? 'https://drive.google.com/file/d/.../view'
                            : 'https://cdn.seudominio.com/trailer.mp4'
                      }
                      className="w-full px-3.5 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white font-mono"
                    />
                  </div>
                </div>

                {rawTrailerLink.trim() && trailerProvider !== 'gcs_hls' && (
                  <p className="text-xs">
                    {detectedTrailerId ? (
                      <span className="text-[#4ADE80]">
                        {trailerProvider === 'youtube' ? 'Vídeo do YouTube identificado: ' : 'ID do Google Drive identificado: '}
                        <code className="font-mono">{detectedTrailerId}</code>
                      </span>
                    ) : (
                      <span className="text-[#F87171]">
                        {trailerProvider === 'youtube'
                          ? 'Link do YouTube não reconhecido.'
                          : 'ID do Google Drive não identificado neste link.'}
                      </span>
                    )}
                  </p>
                )}

                <p className="text-xs text-neutral-500">
                  O teaser/trailer aparece no banner de destaque e nos detalhes do filme sem descontar os minutos gratuitos do assinante.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex flex-wrap items-center gap-4">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PublishStatus)}
                    className="px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-xs text-white"
                  >
                    <option value="published">Publicado no catálogo</option>
                    <option value="draft">Rascunho (oculto)</option>
                  </select>

                  <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                      className="rounded border-white/20 bg-[#090A0D]"
                    />
                    <span>Destacar no topo (mais recentes primeiro)</span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                  >
                    {submitting ? 'Salvando...' : 'Salvar filme'}
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
