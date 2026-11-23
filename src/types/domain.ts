import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'subscriber' | 'admin';

export type AccountStatus = 'trial' | 'active' | 'expired' | 'frozen' | 'blocked';

export type AuthProviderType = 'google' | 'password' | 'admin_provisioned';

export type AgeRating = 'L' | '10' | '12' | '14' | '16' | '18';

export type PublishStatus = 'published' | 'draft';

export type MediaProviderType = 'google_drive' | 'gcs_hls' | 'youtube';

export type DeviceTarget =
  | 'web'
  | 'tizen'
  | 'webos'
  | 'android-tv'
  | 'ios'
  | 'android'
  | 'desktop';

export interface UserAccount {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  authProvider: AuthProviderType;
  planId?: string | null;
  planName?: string | null;
  trialSecondsRemaining: number;
  trialSecondsUsed: number;
  subscriptionStartedAt?: Timestamp | null;
  subscriptionExpiresAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp | null;
}

export interface PlatformSettings {
  platformName: string;
  defaultTrialMinutes: number;
  allowSelfRegistration: boolean;
  initializedByUid: string;
  initializedByEmail: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: 'BRL' | 'USD';
  durationDays: number;
  benefits: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Movie {
  id: string;
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
  hasVideoSource: boolean;
  hasTrailer?: boolean;
  status: PublishStatus;
  featured: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Series {
  id: string;
  title: string;
  synopsis: string;
  posterUrl: string;
  bannerUrl: string;
  categoryId: string;
  genre: string;
  releaseYear: number;
  ageRating: AgeRating;
  language: string;
  hasTrailer?: boolean;
  status: PublishStatus;
  featured: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Season {
  id: string;
  seriesId: string;
  seasonNumber: number;
  title: string;
  synopsis: string;
  status: PublishStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Episode {
  id: string;
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
  hasVideoSource: boolean;
  status: PublishStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MediaSource {
  id: string;
  mediaType: 'movie' | 'episode' | 'trailer';
  mediaId: string;
  provider: MediaProviderType;
  driveFileId: string;
  sourceUrl: string;
  subtitleUrl: string;
  qualityLabel: string;
  updatedByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AdminAuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType:
    | 'user'
    | 'plan'
    | 'settings'
    | 'admin'
    | 'category'
    | 'movie'
    | 'series'
    | 'season'
    | 'episode'
    | 'media';
  targetId: string;
  summary: string;
  createdAt: Timestamp;
}

export interface WatchHistoryItem {
  id: string;
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
  completed: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FavoriteItem {
  id: string;
  uid: string;
  mediaType: 'movie' | 'series';
  mediaId: string;
  title: string;
  posterUrl: string;
  genre: string;
  releaseYear: number;
  createdAt: Timestamp;
}

export interface PlaybackAuthorizeResult {
  allowed: boolean;
  sessionId: string;
  provider?: MediaProviderType;
  embedUrl?: string;
  streamUrl: string;
  subtitleUrl: string;
  qualityLabel: string;
  accessMode: 'active' | 'trial' | 'admin' | 'trailer';
  trialSecondsRemaining: number;
  trialSecondsUsed: number;
}

