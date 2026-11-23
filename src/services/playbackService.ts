import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../config/firebase';
import type {
  FavoriteItem,
  PlaybackAuthorizeResult,
  WatchHistoryItem,
} from '../types/domain';
import { sanitizeText } from '../utils/formatters';
import { sanitizeSafeUrl } from '../utils/mediaLinks';

export class PlaybackAuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlaybackAuthError';
    this.code = code;
  }
}

async function requireIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new PlaybackAuthError('UNAUTHENTICATED', 'Sessão expirada. Faça login novamente.');
  }
  return user.getIdToken();
}

export async function authorizePlayback(
  mediaId: string,
  mediaType: 'movie' | 'episode' | 'trailer'
): Promise<PlaybackAuthorizeResult> {
  const token = await requireIdToken();
  const res = await fetch('/api/playback/authorize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaId, mediaType }),
  });

  const data = (await res.json().catch(() => ({}))) as Partial<PlaybackAuthorizeResult> & {
    error?: string;
    message?: string;
  };

  if (!res.ok || !data.allowed || !data.sessionId || (!data.streamUrl && !data.embedUrl)) {
    throw new PlaybackAuthError(
      data.error || 'PLAYBACK_DENIED',
      data.message || 'Não foi possível iniciar a reprodução.'
    );
  }

  return data as PlaybackAuthorizeResult;
}

export async function probeMediaStream(
  streamUrl: string
): Promise<{ ok: boolean; errorCode?: string; message?: string }> {
  try {
    const probeUrl = streamUrl.replace('/api/media/stream', '/api/media/probe');
    const res = await fetch(probeUrl);
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      errorCode?: string;
      message?: string;
    };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        errorCode: json.errorCode || 'STREAM_UNAVAILABLE',
        message: json.message || 'Não foi possível carregar o vídeo.',
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

export interface HeartbeatResponse {
  allowed: boolean;
  reason?: string;
  accessMode?: 'active' | 'trial' | 'admin' | 'trailer';
  trialSecondsRemaining?: number;
  trialSecondsUsed?: number;
}

export async function sendPlaybackHeartbeat(
  sessionId: string,
  state: 'playing' | 'paused'
): Promise<HeartbeatResponse> {
  try {
    const token = await requireIdToken();
    const res = await fetch('/api/playback/heartbeat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, state }),
    });
    const json = (await res.json().catch(() => ({}))) as HeartbeatResponse;
    return json;
  } catch {
    return { allowed: true };
  }
}

export async function stopPlaybackSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    const token = await requireIdToken();
    await fetch('/api/playback/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    });
  } catch {
    // Non-fatal cleanup
  }
}

// ---------------------------------------------------------------------------
// Watch History ("Continuar Assistindo" + Histórico)
// ---------------------------------------------------------------------------
export function subscribeWatchHistory(
  uid: string,
  onData: (items: WatchHistoryItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'watchHistory';
  const q = query(collection(db, path), where('uid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<WatchHistoryItem, 'id'>),
        }))
        .sort((a, b) => {
          const aMs = a.updatedAt?.toMillis?.() ?? 0;
          const bMs = b.updatedAt?.toMillis?.() ?? 0;
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

export async function saveWatchProgress(input: {
  uid: string;
  mediaType: 'movie' | 'episode';
  mediaId: string;
  seriesId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  title: string;
  posterUrl: string;
  progressSeconds: number;
  durationSeconds: number;
}): Promise<void> {
  const historyId = `${input.uid}_${input.mediaId}`.slice(0, 128);
  const ref = doc(db, 'watchHistory', historyId);

  const safeProgress = Math.max(0, Math.min(86400, Math.round(input.progressSeconds)));
  const safeDuration = Math.max(0, Math.min(86400, Math.round(input.durationSeconds)));
  const completed =
    safeDuration > 30 && safeProgress >= Math.floor(safeDuration * 0.94);

  const safeTitle = sanitizeText(input.title, 160) || 'Título';
  const safePoster = sanitizeSafeUrl(input.posterUrl, 1000);

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        title: safeTitle,
        posterUrl: safePoster,
        progressSeconds: safeProgress,
        durationSeconds: safeDuration,
        completed,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid: input.uid,
        mediaType: input.mediaType,
        mediaId: input.mediaId,
        seriesId: input.seriesId ?? null,
        seasonNumber: input.seasonNumber ?? null,
        episodeNumber: input.episodeNumber ?? null,
        title: safeTitle,
        posterUrl: safePoster,
        progressSeconds: safeProgress,
        durationSeconds: safeDuration,
        completed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('[WatchHistory] Erro ao salvar progresso:', err);
  }
}

// ---------------------------------------------------------------------------
// Favorites ("Minha Lista")
// ---------------------------------------------------------------------------
export function subscribeFavorites(
  uid: string,
  onData: (items: FavoriteItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'favorites';
  const q = query(collection(db, path), where('uid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<FavoriteItem, 'id'>),
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

export async function toggleFavoriteItem(
  uid: string,
  item: {
    mediaType: 'movie' | 'series';
    mediaId: string;
    title: string;
    posterUrl: string;
    genre: string;
    releaseYear: number;
  },
  isCurrentlyFavorite: boolean
): Promise<boolean> {
  const favId = `${uid}_${item.mediaType}_${item.mediaId}`.slice(0, 128);
  const ref = doc(db, 'favorites', favId);

  try {
    if (isCurrentlyFavorite) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, {
      uid,
      mediaType: item.mediaType,
      mediaId: item.mediaId,
      title: sanitizeText(item.title, 160) || 'Título',
      posterUrl: sanitizeSafeUrl(item.posterUrl, 1000),
      genre: sanitizeText(item.genre, 80) || 'Geral',
      releaseYear: Math.max(1900, Math.min(2100, Math.round(item.releaseYear || 2024))),
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `favorites/${favId}`);
  }
}
