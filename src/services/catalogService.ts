import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../config/firebase';
import type {
  AgeRating,
  Category,
  Episode,
  MediaProviderType,
  MediaSource,
  Movie,
  PublishStatus,
  Season,
  Series,
  UserAccount,
} from '../types/domain';
import { sanitizeText } from '../utils/formatters';
import {
  extractDriveFileId,
  extractYouTubeVideoId,
  sanitizeSafeUrl,
  slugifyCategory,
} from '../utils/mediaLinks';

function generateSafeId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw}`;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export function subscribeCategories(
  includeInactive: boolean,
  onData: (categories: Category[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'categories';
  const q = includeInactive
    ? query(collection(db, 'categories'), orderBy('sortOrder', 'asc'))
    : query(collection(db, 'categories'), where('isActive', '==', true));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Category, 'id'>),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function saveCategory(
  actor: UserAccount,
  input: { id?: string; name: string; sortOrder: number; isActive: boolean }
): Promise<void> {
  const safeName = sanitizeText(input.name, 60);
  if (safeName.length < 2) {
    throw new Error('O nome da categoria deve ter pelo menos 2 caracteres.');
  }
  const catId = input.id || generateSafeId('cat');
  const isEdit = Boolean(input.id);
  const batch = writeBatch(db);
  const ref = doc(db, 'categories', catId);

  if (isEdit) {
    batch.update(ref, {
      name: safeName,
      slug: slugifyCategory(safeName),
      sortOrder: Math.max(0, Math.min(1000, Math.round(input.sortOrder))),
      isActive: input.isActive,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(ref, {
      name: safeName,
      slug: slugifyCategory(safeName),
      sortOrder: Math.max(0, Math.min(1000, Math.round(input.sortOrder))),
      isActive: input.isActive,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_CATEGORY' : 'CREATE_CATEGORY',
    targetType: 'category',
    targetId: catId,
    summary: sanitizeText(
      `${isEdit ? 'Categoria atualizada' : 'Categoria criada'}: ${safeName}.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `categories/${catId}`);
  }
}

export async function seedDefaultCategories(actor: UserAccount): Promise<void> {
  const defaults = [
    'Ação',
    'Drama',
    'Ficção Científica',
    'Suspense',
    'Comédia',
    'Documentário',
  ];
  const batch = writeBatch(db);
  defaults.forEach((name, index) => {
    const catId = generateSafeId('cat');
    batch.set(doc(db, 'categories', catId), {
      name,
      slug: slugifyCategory(name),
      sortOrder: index + 1,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'SEED_CATEGORIES',
    targetType: 'category',
    targetId: 'default_pack',
    summary: 'Categorias iniciais do catálogo criadas.',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'categories');
  }
}

export async function deleteCategory(actor: UserAccount, category: Category): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'categories', category.id));
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_CATEGORY',
    targetType: 'category',
    targetId: category.id,
    summary: sanitizeText(`Categoria "${category.name}" excluída.`, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `categories/${category.id}`);
  }
}

// ---------------------------------------------------------------------------
// Media Source Vault (Admin-only)
// ---------------------------------------------------------------------------
export async function getMediaSourceForAdmin(mediaId: string): Promise<MediaSource | null> {
  const path = `mediaSources/${mediaId}`;
  try {
    const snap = await getDoc(doc(db, 'mediaSources', mediaId));
    if (!snap.exists()) return null;
    return {
      id: snap.id,
      ...(snap.data() as Omit<MediaSource, 'id'>),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

async function syncMediaVaultItemsToServer(
  items: Array<{
    mediaId: string;
    mediaType: 'movie' | 'episode' | 'trailer';
    provider: MediaProviderType;
    driveFileId: string;
    sourceUrl: string;
    subtitleUrl: string;
    qualityLabel: string;
  }>
): Promise<void> {
  if (items.length === 0) return;
  const user = auth.currentUser;
  if (!user) return;
  try {
    const token = await user.getIdToken();
    await fetch('/api/admin/media-sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    });
  } catch (err) {
    console.warn('[MediaVault] Falha ao sincronizar com servidor:', err);
  }
}

async function deleteMediaVaultItemFromServer(mediaId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const token = await user.getIdToken();
    await fetch(`/api/admin/media-vault/${encodeURIComponent(mediaId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.warn('[MediaVault] Falha ao remover mídia do servidor:', err);
  }
}

export async function syncAllMediaSourcesToServer(): Promise<void> {
  try {
    const [movSnap, epSnap, movTrailerSnap, serTrailerSnap] = await Promise.all([
      getDocs(query(collection(db, 'movies'), where('hasVideoSource', '==', true))),
      getDocs(query(collection(db, 'episodes'), where('hasVideoSource', '==', true))),
      getDocs(query(collection(db, 'movies'), where('hasTrailer', '==', true))),
      getDocs(query(collection(db, 'series'), where('hasTrailer', '==', true))),
    ]);
    const ids = Array.from(
      new Set([
        ...movSnap.docs.map((d) => d.id),
        ...epSnap.docs.map((d) => d.id),
        ...movTrailerSnap.docs.map((d) => `trl_${d.id}`),
        ...serTrailerSnap.docs.map((d) => `trl_${d.id}`),
      ])
    );
    if (ids.length === 0) return;
    const sources = await Promise.all(
      ids.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, 'mediaSources', id));
          return snap.exists() ? (snap.data() as Omit<MediaSource, 'id'>) : null;
        } catch {
          return null;
        }
      })
    );
    const valid = sources.filter((s): s is Omit<MediaSource, 'id'> => Boolean(s));
    await syncMediaVaultItemsToServer(
      valid.map((s) => ({
        mediaId: s.mediaId,
        mediaType: s.mediaType,
        provider: s.provider,
        driveFileId: s.driveFileId,
        sourceUrl: s.sourceUrl,
        subtitleUrl: s.subtitleUrl,
        qualityLabel: s.qualityLabel,
      }))
    );
  } catch (err) {
    console.warn('[MediaVault] Sincronização inicial ignorada:', err);
  }
}

// ---------------------------------------------------------------------------
// Movies + Media Source
// ---------------------------------------------------------------------------
export function subscribeMovies(
  includeDrafts: boolean,
  onData: (movies: Movie[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'movies';
  const q = includeDrafts
    ? query(collection(db, 'movies'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'movies'), where('status', '==', 'published'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Movie, 'id'>),
        }))
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          return bMs - aMs;
        });
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

function parseTrailerInput(
  trailerInput?: {
    provider: MediaProviderType;
    rawTrailerLinkOrId: string;
    existingTrailerExists?: boolean;
  }
): {
  hasTrailer: boolean;
  provider: MediaProviderType;
  driveFileId: string;
  sourceUrl: string;
  existingTrailerExists: boolean;
} {
  if (!trailerInput) {
    return {
      hasTrailer: false,
      provider: 'google_drive',
      driveFileId: '',
      sourceUrl: '',
      existingTrailerExists: false,
    };
  }
  const raw = trailerInput.rawTrailerLinkOrId.trim();
  const provider = trailerInput.provider;
  if (!raw) {
    return {
      hasTrailer: false,
      provider,
      driveFileId: '',
      sourceUrl: '',
      existingTrailerExists: Boolean(trailerInput.existingTrailerExists),
    };
  }
  if (provider === 'google_drive') {
    const driveId = extractDriveFileId(raw);
    if (!driveId) {
      throw new Error(
        'Link ou ID do Google Drive do teaser/trailer inválido. Cole o link completo de compartilhamento ou o ID do arquivo.'
      );
    }
    return {
      hasTrailer: true,
      provider,
      driveFileId: driveId,
      sourceUrl: sanitizeSafeUrl(raw, 1000) || `https://drive.google.com/file/d/${driveId}/view`,
      existingTrailerExists: Boolean(trailerInput.existingTrailerExists),
    };
  }
  if (provider === 'youtube') {
    const ytId = extractYouTubeVideoId(raw);
    if (!ytId) {
      throw new Error(
        'Link ou ID do YouTube inválido para o teaser/trailer. Cole um link youtube.com/watch?v=... ou youtu.be/...'
      );
    }
    return {
      hasTrailer: true,
      provider: 'youtube',
      driveFileId: ytId,
      sourceUrl: `https://www.youtube.com/watch?v=${ytId}`,
      existingTrailerExists: Boolean(trailerInput.existingTrailerExists),
    };
  }
  const safeUrl = sanitizeSafeUrl(raw, 1000);
  if (!safeUrl) {
    throw new Error('URL do teaser/trailer inválida. Utilize um endereço http:// ou https:// válido.');
  }
  return {
    hasTrailer: true,
    provider: 'gcs_hls',
    driveFileId: '',
    sourceUrl: safeUrl,
    existingTrailerExists: Boolean(trailerInput.existingTrailerExists),
  };
}

export async function saveMovieWithMedia(
  actor: UserAccount,
  movieInput: {
    id?: string;
    title: string;
    synopsis: string;
    posterUrl: string;
    bannerUrl: string;
    categoryId: string;
    genre: string;
    releaseYear: number;
    durationMinutes: number;
    ageRating: AgeRating;
    language: string;
    subtitlesLabel: string;
    status: PublishStatus;
    featured: boolean;
  },
  mediaInput: {
    provider: MediaProviderType;
    rawVideoLinkOrId: string;
    subtitleUrl: string;
    qualityLabel: string;
    existingSourceExists?: boolean;
  },
  trailerInput?: {
    provider: MediaProviderType;
    rawTrailerLinkOrId: string;
    existingTrailerExists?: boolean;
  }
): Promise<void> {
  const safeTitle = sanitizeText(movieInput.title, 160);
  const safeSynopsis = sanitizeText(movieInput.synopsis, 1500);
  if (!safeTitle || safeSynopsis.length < 4) {
    throw new Error('Preencha título e sinopse do filme.');
  }
  if (!movieInput.categoryId) {
    throw new Error('Selecione uma categoria para o filme.');
  }

  const rawLink = mediaInput.rawVideoLinkOrId.trim();
  const driveFileId =
    mediaInput.provider === 'google_drive' ? extractDriveFileId(rawLink) : '';
  const safeSourceUrl = sanitizeSafeUrl(rawLink, 1000);

  if (mediaInput.provider === 'google_drive' && rawLink && !driveFileId) {
    throw new Error(
      'Link ou ID do Google Drive inválido. Cole o link completo de compartilhamento ou o ID do arquivo.'
    );
  }
  if (mediaInput.provider === 'gcs_hls' && rawLink && !safeSourceUrl) {
    throw new Error('URL de vídeo inválida. Utilize um endereço http:// ou https:// válido.');
  }

  const hasVideoSource =
    mediaInput.provider === 'google_drive' ? Boolean(driveFileId) : Boolean(safeSourceUrl);
  const trailer = parseTrailerInput(trailerInput);

  const isEdit = Boolean(movieInput.id);
  const movieId = movieInput.id || generateSafeId('mov');
  const trailerMediaId = `trl_${movieId}`;
  const batch = writeBatch(db);
  const movieRef = doc(db, 'movies', movieId);

  const moviePayload = {
    title: safeTitle,
    synopsis: safeSynopsis,
    posterUrl: sanitizeSafeUrl(movieInput.posterUrl, 1000),
    bannerUrl: sanitizeSafeUrl(movieInput.bannerUrl, 1000),
    categoryId: movieInput.categoryId,
    genre: sanitizeText(movieInput.genre, 80) || 'Geral',
    releaseYear: Math.max(1900, Math.min(2100, Math.round(movieInput.releaseYear))),
    durationMinutes: Math.max(1, Math.min(600, Math.round(movieInput.durationMinutes))),
    ageRating: movieInput.ageRating,
    language: sanitizeText(movieInput.language, 60) || 'Português',
    subtitlesLabel: sanitizeText(movieInput.subtitlesLabel, 120),
    hasVideoSource,
    hasTrailer: trailer.hasTrailer,
    status: movieInput.status,
    featured: movieInput.featured,
    updatedAt: serverTimestamp(),
  };

  if (isEdit) {
    batch.update(movieRef, moviePayload);
  } else {
    batch.set(movieRef, {
      ...moviePayload,
      createdAt: serverTimestamp(),
    });
  }

  const syncItems: Array<{
    mediaId: string;
    mediaType: 'movie' | 'episode' | 'trailer';
    provider: MediaProviderType;
    driveFileId: string;
    sourceUrl: string;
    subtitleUrl: string;
    qualityLabel: string;
  }> = [];

  if (hasVideoSource) {
    const sourceRef = doc(db, 'mediaSources', movieId);
    const resolvedUrl =
      safeSourceUrl || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : '');
    const safeSubUrl = sanitizeSafeUrl(mediaInput.subtitleUrl, 1000);
    const safeQuality = sanitizeText(mediaInput.qualityLabel, 40) || '1080p';
    const sourcePayload = {
      mediaType: 'movie' as const,
      mediaId: movieId,
      provider: mediaInput.provider,
      driveFileId,
      sourceUrl: resolvedUrl,
      subtitleUrl: safeSubUrl,
      qualityLabel: safeQuality,
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    };

    if (mediaInput.existingSourceExists) {
      batch.update(sourceRef, sourcePayload);
    } else {
      batch.set(sourceRef, {
        ...sourcePayload,
        createdAt: serverTimestamp(),
      });
    }
    syncItems.push({
      mediaId: movieId,
      mediaType: 'movie',
      provider: mediaInput.provider,
      driveFileId,
      sourceUrl: resolvedUrl,
      subtitleUrl: safeSubUrl,
      qualityLabel: safeQuality,
    });
  } else if (mediaInput.existingSourceExists) {
    batch.delete(doc(db, 'mediaSources', movieId));
  }

  if (trailer.hasTrailer) {
    const trailerRef = doc(db, 'mediaSources', trailerMediaId);
    const trailerPayload = {
      mediaType: 'trailer' as const,
      mediaId: trailerMediaId,
      provider: trailer.provider,
      driveFileId: trailer.driveFileId,
      sourceUrl: trailer.sourceUrl,
      subtitleUrl: '',
      qualityLabel: 'Trailer',
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    };
    if (trailer.existingTrailerExists) {
      batch.update(trailerRef, trailerPayload);
    } else {
      batch.set(trailerRef, {
        ...trailerPayload,
        createdAt: serverTimestamp(),
      });
    }
    syncItems.push({
      mediaId: trailerMediaId,
      mediaType: 'trailer',
      provider: trailer.provider,
      driveFileId: trailer.driveFileId,
      sourceUrl: trailer.sourceUrl,
      subtitleUrl: '',
      qualityLabel: 'Trailer',
    });
  } else if (trailer.existingTrailerExists) {
    batch.delete(doc(db, 'mediaSources', trailerMediaId));
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_MOVIE' : 'CREATE_MOVIE',
    targetType: 'movie',
    targetId: movieId,
    summary: sanitizeText(
      `${isEdit ? 'Filme atualizado' : 'Filme cadastrado'}: "${safeTitle}" (${
        hasVideoSource ? 'vídeo vinculado' : 'sem link de vídeo'
      }${trailer.hasTrailer ? ', com trailer' : ''}).`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (syncItems.length > 0) {
      await syncMediaVaultItemsToServer(syncItems);
    }
    if (!hasVideoSource && mediaInput.existingSourceExists) {
      await deleteMediaVaultItemFromServer(movieId);
    }
    if (!trailer.hasTrailer && trailer.existingTrailerExists) {
      await deleteMediaVaultItemFromServer(trailerMediaId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `movies/${movieId}`);
  }
}

export async function deleteMovieWithMedia(actor: UserAccount, movie: Movie): Promise<void> {
  const trailerMediaId = `trl_${movie.id}`;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'movies', movie.id));
  if (movie.hasVideoSource) {
    batch.delete(doc(db, 'mediaSources', movie.id));
  }
  if (movie.hasTrailer) {
    batch.delete(doc(db, 'mediaSources', trailerMediaId));
  }
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_MOVIE',
    targetType: 'movie',
    targetId: movie.id,
    summary: sanitizeText(`Filme "${movie.title}" excluído do catálogo.`, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (movie.hasVideoSource) {
      await deleteMediaVaultItemFromServer(movie.id);
    }
    if (movie.hasTrailer) {
      await deleteMediaVaultItemFromServer(trailerMediaId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `movies/${movie.id}`);
  }
}

// ---------------------------------------------------------------------------
// Series, Seasons & Episodes
// ---------------------------------------------------------------------------
export function subscribeSeries(
  includeDrafts: boolean,
  onData: (series: Series[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'series';
  const q = includeDrafts
    ? query(collection(db, 'series'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'series'), where('status', '==', 'published'));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Series, 'id'>),
        }))
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() ?? 0;
          const bMs = b.createdAt?.toMillis?.() ?? 0;
          return bMs - aMs;
        });
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function saveSeries(
  actor: UserAccount,
  input: {
    id?: string;
    title: string;
    synopsis: string;
    posterUrl: string;
    bannerUrl: string;
    categoryId: string;
    genre: string;
    releaseYear: number;
    ageRating: AgeRating;
    language: string;
    status: PublishStatus;
    featured: boolean;
  },
  trailerInput?: {
    provider: MediaProviderType;
    rawTrailerLinkOrId: string;
    existingTrailerExists?: boolean;
  }
): Promise<string> {
  const safeTitle = sanitizeText(input.title, 160);
  const safeSynopsis = sanitizeText(input.synopsis, 1500);
  if (!safeTitle || safeSynopsis.length < 4) {
    throw new Error('Preencha título e sinopse da série.');
  }
  if (!input.categoryId) {
    throw new Error('Selecione uma categoria para a série.');
  }

  const trailer = parseTrailerInput(trailerInput);
  const isEdit = Boolean(input.id);
  const seriesId = input.id || generateSafeId('ser');
  const trailerMediaId = `trl_${seriesId}`;
  const batch = writeBatch(db);
  const seriesRef = doc(db, 'series', seriesId);

  const payload = {
    title: safeTitle,
    synopsis: safeSynopsis,
    posterUrl: sanitizeSafeUrl(input.posterUrl, 1000),
    bannerUrl: sanitizeSafeUrl(input.bannerUrl, 1000),
    categoryId: input.categoryId,
    genre: sanitizeText(input.genre, 80) || 'Geral',
    releaseYear: Math.max(1900, Math.min(2100, Math.round(input.releaseYear))),
    ageRating: input.ageRating,
    language: sanitizeText(input.language, 60) || 'Português',
    hasTrailer: trailer.hasTrailer,
    status: input.status,
    featured: input.featured,
    updatedAt: serverTimestamp(),
  };

  if (isEdit) {
    batch.update(seriesRef, payload);
  } else {
    batch.set(seriesRef, {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }

  if (trailer.hasTrailer) {
    const trailerRef = doc(db, 'mediaSources', trailerMediaId);
    const trailerPayload = {
      mediaType: 'trailer' as const,
      mediaId: trailerMediaId,
      provider: trailer.provider,
      driveFileId: trailer.driveFileId,
      sourceUrl: trailer.sourceUrl,
      subtitleUrl: '',
      qualityLabel: 'Trailer',
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    };
    if (trailer.existingTrailerExists) {
      batch.update(trailerRef, trailerPayload);
    } else {
      batch.set(trailerRef, {
        ...trailerPayload,
        createdAt: serverTimestamp(),
      });
    }
  } else if (trailer.existingTrailerExists) {
    batch.delete(doc(db, 'mediaSources', trailerMediaId));
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_SERIES' : 'CREATE_SERIES',
    targetType: 'series',
    targetId: seriesId,
    summary: sanitizeText(
      `${isEdit ? 'Série atualizada' : 'Série criada'}: "${safeTitle}"${
        trailer.hasTrailer ? ' (com trailer)' : ''
      }.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (trailer.hasTrailer) {
      await syncMediaVaultItemsToServer([
        {
          mediaId: trailerMediaId,
          mediaType: 'trailer',
          provider: trailer.provider,
          driveFileId: trailer.driveFileId,
          sourceUrl: trailer.sourceUrl,
          subtitleUrl: '',
          qualityLabel: 'Trailer',
        },
      ]);
    } else if (trailer.existingTrailerExists) {
      await deleteMediaVaultItemFromServer(trailerMediaId);
    }
    return seriesId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `series/${seriesId}`);
  }
}

export async function deleteSeries(actor: UserAccount, series: Series): Promise<void> {
  const trailerMediaId = `trl_${series.id}`;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'series', series.id));
  if (series.hasTrailer) {
    batch.delete(doc(db, 'mediaSources', trailerMediaId));
  }
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_SERIES',
    targetType: 'series',
    targetId: series.id,
    summary: sanitizeText(`Série "${series.title}" excluída.`, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (series.hasTrailer) {
      await deleteMediaVaultItemFromServer(trailerMediaId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `series/${series.id}`);
  }
}

export function subscribeSeasonsBySeries(
  seriesId: string,
  includeDrafts: boolean,
  onData: (seasons: Season[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'seasons';
  const q = includeDrafts
    ? query(collection(db, 'seasons'), where('seriesId', '==', seriesId))
    : query(
        collection(db, 'seasons'),
        where('seriesId', '==', seriesId),
        where('status', '==', 'published')
      );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Season, 'id'>),
        }))
        .sort((a, b) => a.seasonNumber - b.seasonNumber);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function saveSeason(
  actor: UserAccount,
  input: {
    id?: string;
    seriesId: string;
    seasonNumber: number;
    title: string;
    synopsis: string;
    status: PublishStatus;
  }
): Promise<string> {
  const safeTitle = sanitizeText(input.title, 120) || `Temporada ${input.seasonNumber}`;
  const isEdit = Boolean(input.id);
  const seasonId = input.id || generateSafeId('sea');
  const batch = writeBatch(db);
  const ref = doc(db, 'seasons', seasonId);

  if (isEdit) {
    batch.update(ref, {
      seasonNumber: Math.max(1, Math.min(100, Math.round(input.seasonNumber))),
      title: safeTitle,
      synopsis: sanitizeText(input.synopsis, 800),
      status: input.status,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(ref, {
      seriesId: input.seriesId,
      seasonNumber: Math.max(1, Math.min(100, Math.round(input.seasonNumber))),
      title: safeTitle,
      synopsis: sanitizeText(input.synopsis, 800),
      status: input.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_SEASON' : 'CREATE_SEASON',
    targetType: 'season',
    targetId: seasonId,
    summary: sanitizeText(
      `${isEdit ? 'Temporada atualizada' : 'Temporada criada'}: ${safeTitle} (S${input.seasonNumber}).`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return seasonId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `seasons/${seasonId}`);
  }
}

export async function deleteSeason(actor: UserAccount, season: Season): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'seasons', season.id));
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_SEASON',
    targetType: 'season',
    targetId: season.id,
    summary: sanitizeText(`Temporada "${season.title}" excluída.`, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `seasons/${season.id}`);
  }
}

export function subscribeEpisodesBySeries(
  seriesId: string,
  includeDrafts: boolean,
  onData: (episodes: Episode[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'episodes';
  const q = includeDrafts
    ? query(collection(db, 'episodes'), where('seriesId', '==', seriesId))
    : query(
        collection(db, 'episodes'),
        where('seriesId', '==', seriesId),
        where('status', '==', 'published')
      );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Episode, 'id'>),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.episodeNumber - b.episodeNumber);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export interface DraftEpisodeInput {
  episodeNumber: number;
  sortOrder?: number;
  title?: string;
  description?: string;
  durationMinutes?: number;
  thumbnailUrl?: string;
  subtitlesLabel?: string;
  status?: PublishStatus;
  provider: MediaProviderType;
  rawVideoLinkOrId: string;
  subtitleUrl?: string;
  qualityLabel?: string;
}

export interface DraftSeasonInput {
  seasonNumber: number;
  title?: string;
  synopsis?: string;
  status?: PublishStatus;
  episodes: DraftEpisodeInput[];
}

interface NormalizedEpisodeWrite {
  episodeId: string;
  seasonId: string;
  seasonNumber: number;
  episodeNumber: number;
  sortOrder: number;
  title: string;
  description: string;
  durationMinutes: number;
  thumbnailUrl: string;
  subtitlesLabel: string;
  status: PublishStatus;
  hasVideoSource: boolean;
  provider: MediaProviderType;
  driveFileId: string;
  sourceUrl: string;
  subtitleUrl: string;
  qualityLabel: string;
}

function normalizeEpisodeDraft(
  seasonId: string,
  seasonNumber: number,
  ep: DraftEpisodeInput
): NormalizedEpisodeWrite {
  const safeSeasonNum = Math.max(1, Math.min(100, Math.round(seasonNumber)));
  const safeEpNum = Math.max(1, Math.min(1000, Math.round(ep.episodeNumber || 1)));
  const safeSortOrder = Math.max(
    0,
    Math.min(10000, Math.round(ep.sortOrder ?? safeSeasonNum * 100 + safeEpNum))
  );
  const safeTitle =
    sanitizeText(ep.title || '', 160) || `Episódio ${safeEpNum}`;
  const rawDesc = sanitizeText(ep.description || '', 1200);
  const safeDesc =
    rawDesc.length >= 4
      ? rawDesc
      : `Episódio ${safeEpNum} da Temporada ${safeSeasonNum}.`;

  const rawLink = (ep.rawVideoLinkOrId || '').trim();
  const provider: MediaProviderType =
    ep.provider === 'gcs_hls' ? 'gcs_hls' : 'google_drive';
  const driveFileId =
    provider === 'google_drive' ? extractDriveFileId(rawLink) : '';
  const safeSourceUrl = sanitizeSafeUrl(rawLink, 1000);

  if (provider === 'google_drive' && rawLink && !driveFileId) {
    throw new Error(
      `T${safeSeasonNum} · Ep. ${safeEpNum}: link ou ID do Google Drive inválido.`
    );
  }
  if (provider === 'gcs_hls' && rawLink && !safeSourceUrl) {
    throw new Error(
      `T${safeSeasonNum} · Ep. ${safeEpNum}: URL de vídeo inválida (use http:// ou https://).`
    );
  }

  const hasVideoSource =
    provider === 'google_drive' ? Boolean(driveFileId) : Boolean(safeSourceUrl);

  return {
    episodeId: generateSafeId('ep'),
    seasonId,
    seasonNumber: safeSeasonNum,
    episodeNumber: safeEpNum,
    sortOrder: safeSortOrder,
    title: safeTitle,
    description: safeDesc,
    durationMinutes: Math.max(1, Math.min(600, Math.round(ep.durationMinutes ?? 45))),
    thumbnailUrl: sanitizeSafeUrl(ep.thumbnailUrl || '', 1000),
    subtitlesLabel: sanitizeText(ep.subtitlesLabel || 'PT-BR, EN', 120),
    status: ep.status === 'draft' ? 'draft' : 'published',
    hasVideoSource,
    provider,
    driveFileId,
    sourceUrl:
      safeSourceUrl ||
      (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : ''),
    subtitleUrl: sanitizeSafeUrl(ep.subtitleUrl || '', 1000),
    qualityLabel: sanitizeText(ep.qualityLabel || '1080p Full HD', 40) || '1080p',
  };
}

async function commitNormalizedEpisodes(
  actor: UserAccount,
  seriesId: string,
  normalizedEpisodes: NormalizedEpisodeWrite[],
  auditSummary?: string
): Promise<void> {
  if (normalizedEpisodes.length === 0) return;

  // Commit in chunks (< 500 Firestore batch write limit; each episode can write 2 docs)
  const chunkSize = 180;
  for (let i = 0; i < normalizedEpisodes.length; i += chunkSize) {
    const chunk = normalizedEpisodes.slice(i, i + chunkSize);
    const batch = writeBatch(db);

    for (const ep of chunk) {
      batch.set(doc(db, 'episodes', ep.episodeId), {
        seriesId,
        seasonId: ep.seasonId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        sortOrder: ep.sortOrder,
        title: ep.title,
        description: ep.description,
        durationMinutes: ep.durationMinutes,
        thumbnailUrl: ep.thumbnailUrl,
        subtitlesLabel: ep.subtitlesLabel,
        hasVideoSource: ep.hasVideoSource,
        status: ep.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (ep.hasVideoSource) {
        batch.set(doc(db, 'mediaSources', ep.episodeId), {
          mediaType: 'episode' as const,
          mediaId: ep.episodeId,
          provider: ep.provider,
          driveFileId: ep.driveFileId,
          sourceUrl: ep.sourceUrl,
          subtitleUrl: ep.subtitleUrl,
          qualityLabel: ep.qualityLabel,
          updatedByUid: actor.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (i === 0) {
      batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
        actorUid: actor.uid,
        actorEmail: sanitizeText(actor.email, 254),
        action: 'CREATE_EPISODES_BATCH',
        targetType: 'episode',
        targetId: normalizedEpisodes[0].episodeId,
        summary: sanitizeText(
          auditSummary ||
            `${normalizedEpisodes.length} episódio(s) cadastrado(s) na série.`,
          400
        ),
        createdAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'episodes');
    }
  }

  const vaultItems = normalizedEpisodes
    .filter((ep) => ep.hasVideoSource)
    .map((ep) => ({
      mediaId: ep.episodeId,
      mediaType: 'episode' as const,
      provider: ep.provider,
      driveFileId: ep.driveFileId,
      sourceUrl: ep.sourceUrl,
      subtitleUrl: ep.subtitleUrl,
      qualityLabel: ep.qualityLabel,
    }));

  if (vaultItems.length > 0) {
    await syncMediaVaultItemsToServer(vaultItems);
  }
}

export async function saveEpisodesBatchWithMedia(
  actor: UserAccount,
  seriesId: string,
  seasonId: string,
  seasonNumber: number,
  episodeDrafts: DraftEpisodeInput[]
): Promise<number> {
  if (episodeDrafts.length === 0) return 0;
  const normalized = episodeDrafts.map((ep) =>
    normalizeEpisodeDraft(seasonId, seasonNumber, ep)
  );
  await commitNormalizedEpisodes(
    actor,
    seriesId,
    normalized,
    `${normalized.length} episódio(s) adicionado(s) à Temporada ${seasonNumber}.`
  );
  return normalized.length;
}

export async function addSeasonsAndEpisodesToSeries(
  actor: UserAccount,
  seriesId: string,
  seasonDrafts: DraftSeasonInput[]
): Promise<{ createdSeasonIds: string[]; episodeCount: number }> {
  if (seasonDrafts.length === 0) {
    return { createdSeasonIds: [], episodeCount: 0 };
  }

  const preparedSeasons = seasonDrafts.map((s) => {
    const safeNum = Math.max(1, Math.min(100, Math.round(s.seasonNumber || 1)));
    const seasonId = generateSafeId('sea');
    const safeTitle = sanitizeText(s.title || '', 120) || `Temporada ${safeNum}`;
    const safeSynopsis = sanitizeText(s.synopsis || '', 800);
    const status: PublishStatus = s.status === 'draft' ? 'draft' : 'published';
    const normalizedEps = s.episodes.map((ep) =>
      normalizeEpisodeDraft(seasonId, safeNum, ep)
    );
    return {
      seasonId,
      seasonNumber: safeNum,
      title: safeTitle,
      synopsis: safeSynopsis,
      status,
      episodes: normalizedEps,
    };
  });

  // Step 1: Commit Season documents first so Firestore exists() rules for Episodes pass
  const seasonBatch = writeBatch(db);
  for (const s of preparedSeasons) {
    seasonBatch.set(doc(db, 'seasons', s.seasonId), {
      seriesId,
      seasonNumber: s.seasonNumber,
      title: s.title,
      synopsis: s.synopsis,
      status: s.status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  seasonBatch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'CREATE_SEASON',
    targetType: 'season',
    targetId: preparedSeasons[0].seasonId,
    summary: sanitizeText(
      `${preparedSeasons.length} temporada(s) adicionada(s): ${preparedSeasons
        .map((s) => s.title)
        .join(', ')}.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await seasonBatch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seasons');
  }

  // Step 2: Commit all episodes & video links linked to these committed seasons
  const allEpisodes = preparedSeasons.flatMap((s) => s.episodes);
  await commitNormalizedEpisodes(
    actor,
    seriesId,
    allEpisodes,
    `${allEpisodes.length} episódio(s) cadastrado(s) em ${preparedSeasons.length} temporada(s).`
  );

  return {
    createdSeasonIds: preparedSeasons.map((s) => s.seasonId),
    episodeCount: allEpisodes.length,
  };
}

export async function saveSeriesWithSeasonsAndEpisodes(
  actor: UserAccount,
  input: {
    id?: string;
    title: string;
    synopsis: string;
    posterUrl: string;
    bannerUrl: string;
    categoryId: string;
    genre: string;
    releaseYear: number;
    ageRating: AgeRating;
    language: string;
    status: PublishStatus;
    featured: boolean;
  },
  trailerInput:
    | {
        provider: MediaProviderType;
        rawTrailerLinkOrId: string;
        existingTrailerExists?: boolean;
      }
    | undefined,
  seasonDrafts: DraftSeasonInput[]
): Promise<{ seriesId: string; seasonCount: number; episodeCount: number }> {
  // Validate every season/episode draft upfront before writing anything to Firestore
  for (const s of seasonDrafts) {
    const num = Math.max(1, Math.min(100, Math.round(s.seasonNumber || 1)));
    for (const ep of s.episodes) {
      normalizeEpisodeDraft('preview_sea', num, ep);
    }
  }

  const seriesId = await saveSeries(actor, input, trailerInput);
  if (seasonDrafts.length === 0) {
    return { seriesId, seasonCount: 0, episodeCount: 0 };
  }

  const { createdSeasonIds, episodeCount } = await addSeasonsAndEpisodesToSeries(
    actor,
    seriesId,
    seasonDrafts
  );
  return {
    seriesId,
    seasonCount: createdSeasonIds.length,
    episodeCount,
  };
}

export async function saveEpisodeWithMedia(
  actor: UserAccount,
  epInput: {
    id?: string;
    seriesId: string;
    seasonId: string;
    seasonNumber: number;
    episodeNumber: number;
    sortOrder: number;
    title: string;
    description: string;
    durationMinutes: number;
    thumbnailUrl: string;
    subtitlesLabel: string;
    status: PublishStatus;
  },
  mediaInput: {
    provider: MediaProviderType;
    rawVideoLinkOrId: string;
    subtitleUrl: string;
    qualityLabel: string;
    existingSourceExists?: boolean;
  }
): Promise<void> {
  const safeEpNum = Math.max(1, Math.min(1000, Math.round(epInput.episodeNumber || 1)));
  const safeSeasonNum = Math.max(1, Math.min(100, Math.round(epInput.seasonNumber || 1)));
  const safeTitle = sanitizeText(epInput.title, 160) || `Episódio ${safeEpNum}`;
  const rawDesc = sanitizeText(epInput.description, 1200);
  const safeDesc =
    rawDesc.length >= 4
      ? rawDesc
      : `Episódio ${safeEpNum} da Temporada ${safeSeasonNum}.`;

  const rawLink = mediaInput.rawVideoLinkOrId.trim();
  const driveFileId =
    mediaInput.provider === 'google_drive' ? extractDriveFileId(rawLink) : '';
  const safeSourceUrl = sanitizeSafeUrl(rawLink, 1000);

  if (mediaInput.provider === 'google_drive' && rawLink && !driveFileId) {
    throw new Error(
      'Link ou ID do Google Drive inválido. Cole o link completo de compartilhamento ou o ID do arquivo.'
    );
  }
  if (mediaInput.provider === 'gcs_hls' && rawLink && !safeSourceUrl) {
    throw new Error('URL de vídeo inválida. Utilize um endereço http:// ou https:// válido.');
  }

  const hasVideoSource =
    mediaInput.provider === 'google_drive' ? Boolean(driveFileId) : Boolean(safeSourceUrl);

  const isEdit = Boolean(epInput.id);
  const episodeId = epInput.id || generateSafeId('ep');
  const batch = writeBatch(db);
  const epRef = doc(db, 'episodes', episodeId);

  const epPayload = {
    seasonNumber: Math.max(1, Math.min(100, Math.round(epInput.seasonNumber))),
    episodeNumber: safeEpNum,
    sortOrder: Math.max(0, Math.min(10000, Math.round(epInput.sortOrder))),
    title: safeTitle,
    description: safeDesc,
    durationMinutes: Math.max(1, Math.min(600, Math.round(epInput.durationMinutes))),
    thumbnailUrl: sanitizeSafeUrl(epInput.thumbnailUrl, 1000),
    subtitlesLabel: sanitizeText(epInput.subtitlesLabel, 120),
    hasVideoSource,
    status: epInput.status,
    updatedAt: serverTimestamp(),
  };

  if (isEdit) {
    batch.update(epRef, epPayload);
  } else {
    batch.set(epRef, {
      ...epPayload,
      seriesId: epInput.seriesId,
      seasonId: epInput.seasonId,
      createdAt: serverTimestamp(),
    });
  }

  if (hasVideoSource) {
    const sourceRef = doc(db, 'mediaSources', episodeId);
    const sourcePayload = {
      mediaType: 'episode' as const,
      mediaId: episodeId,
      provider: mediaInput.provider,
      driveFileId,
      sourceUrl: safeSourceUrl || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : ''),
      subtitleUrl: sanitizeSafeUrl(mediaInput.subtitleUrl, 1000),
      qualityLabel: sanitizeText(mediaInput.qualityLabel, 40) || '1080p',
      updatedByUid: actor.uid,
      updatedAt: serverTimestamp(),
    };

    if (mediaInput.existingSourceExists) {
      batch.update(sourceRef, sourcePayload);
    } else {
      batch.set(sourceRef, {
        ...sourcePayload,
        createdAt: serverTimestamp(),
      });
    }
  } else if (mediaInput.existingSourceExists) {
    batch.delete(doc(db, 'mediaSources', episodeId));
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_EPISODE' : 'CREATE_EPISODE',
    targetType: 'episode',
    targetId: episodeId,
    summary: sanitizeText(
      `T${epInput.seasonNumber}E${epInput.episodeNumber} "${safeTitle}" (${
        hasVideoSource ? 'vídeo vinculado' : 'sem link de vídeo'
      }).`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (hasVideoSource) {
      await syncMediaVaultItemsToServer([
        {
          mediaId: episodeId,
          mediaType: 'episode',
          provider: mediaInput.provider,
          driveFileId,
          sourceUrl:
            safeSourceUrl ||
            (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : ''),
          subtitleUrl: sanitizeSafeUrl(mediaInput.subtitleUrl, 1000),
          qualityLabel: sanitizeText(mediaInput.qualityLabel, 40) || '1080p',
        },
      ]);
    } else if (mediaInput.existingSourceExists) {
      await deleteMediaVaultItemFromServer(episodeId);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `episodes/${episodeId}`);
  }
}

export async function deleteEpisodeWithMedia(
  actor: UserAccount,
  episode: Episode
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'episodes', episode.id));
  if (episode.hasVideoSource) {
    batch.delete(doc(db, 'mediaSources', episode.id));
  }
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_EPISODE',
    targetType: 'episode',
    targetId: episode.id,
    summary: sanitizeText(
      `Episódio T${episode.seasonNumber}E${episode.episodeNumber} "${episode.title}" excluído.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    if (episode.hasVideoSource) {
      await deleteMediaVaultItemFromServer(episode.id);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `episodes/${episode.id}`);
  }
}
