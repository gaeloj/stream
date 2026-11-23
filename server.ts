import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import express, { type Request, type Response } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createServer as createViteServer } from 'vite';

interface FirebaseConfigFile {
  projectId: string;
  firestoreDatabaseId: string;
}

interface MediaVaultEntry {
  mediaId: string;
  mediaType: 'movie' | 'episode' | 'trailer';
  provider: 'google_drive' | 'gcs_hls' | 'youtube';
  driveFileId: string;
  sourceUrl: string;
  subtitleUrl: string;
  qualityLabel: string;
  updatedAtIso: string;
}

interface ActivePlaybackSession {
  sessionId: string;
  uid: string;
  role: 'admin' | 'subscriber';
  mediaId: string;
  mediaType: 'movie' | 'episode' | 'trailer';
  accessMode: 'active' | 'trial' | 'admin' | 'trailer';
  isPlaying: boolean;
  lastTickMs: number;
  lastFirestorePatchMs: number;
  uncommittedMs: number;
  trialSecondsRemaining: number;
  trialSecondsUsed: number;
  revoked: boolean;
  revokeReason?: string;
}

interface UserRestSnapshot {
  uid: string;
  role: 'admin' | 'subscriber';
  status: 'trial' | 'active' | 'expired' | 'frozen' | 'blocked';
  trialSecondsRemaining: number;
  trialSecondsUsed: number;
  subscriptionExpiresAtMs: number | null;
  updatedAtMs: number;
}

const BOOTSTRAP_ADMIN_EMAIL = 'oliveira16g8@gmail.com';
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, 'utf-8')
) as FirebaseConfigFile;

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAuth(adminApp);

const SIGNING_SECRET =
  process.env.PLAYBACK_SIGNING_SECRET && process.env.PLAYBACK_SIGNING_SECRET.length >= 16
    ? process.env.PLAYBACK_SIGNING_SECRET
    : crypto.randomBytes(32).toString('hex');

const VAULT_DIR = path.resolve(process.cwd(), '.data');
const VAULT_FILE = path.join(VAULT_DIR, 'media-vault.json');

const mediaVault = new Map<string, MediaVaultEntry>();
const mediaTotalSizeCache = new Map<string, number>();
const activeSessions = new Map<string, ActivePlaybackSession>();

const MAX_STREAM_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB chunk cap (safe under Cloud Run 32 MiB limit)

function parseTotalSizeFromContentRange(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clampRangeHeader(rangeHeader: string | undefined, knownTotalSize?: number): string {
  if (!rangeHeader || !rangeHeader.toLowerCase().startsWith('bytes=')) {
    const end = knownTotalSize
      ? Math.min(MAX_STREAM_CHUNK_BYTES - 1, knownTotalSize - 1)
      : MAX_STREAM_CHUNK_BYTES - 1;
    return `bytes=0-${Math.max(0, end)}`;
  }

  const spec = rangeHeader.slice(6).split(',')[0].trim();

  // Suffix range e.g. bytes=-65536
  const suffixMatch = spec.match(/^-(\d+)$/);
  if (suffixMatch) {
    const suffixLen = Math.min(Number(suffixMatch[1]) || 65536, MAX_STREAM_CHUNK_BYTES);
    if (knownTotalSize && knownTotalSize > 0) {
      const start = Math.max(0, knownTotalSize - suffixLen);
      return `bytes=${start}-${knownTotalSize - 1}`;
    }
    return `bytes=-${suffixLen}`;
  }

  const match = spec.match(/^(\d+)-(\d*)$/);
  if (!match) {
    return `bytes=0-${MAX_STREAM_CHUNK_BYTES - 1}`;
  }

  const start = Number(match[1]);
  const rawEnd = match[2] ? Number(match[2]) : null;
  let end =
    rawEnd !== null && Number.isFinite(rawEnd)
      ? Math.min(rawEnd, start + MAX_STREAM_CHUNK_BYTES - 1)
      : start + MAX_STREAM_CHUNK_BYTES - 1;

  if (knownTotalSize && knownTotalSize > 0) {
    if (start >= knownTotalSize) {
      return `bytes=${Math.max(0, knownTotalSize - 1)}-${knownTotalSize - 1}`;
    }
    end = Math.min(end, knownTotalSize - 1);
  }
  if (end < start) end = start;
  return `bytes=${start}-${end}`;
}

function loadVaultFromDisk(): void {
  try {
    if (!fs.existsSync(VAULT_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8')) as Record<
      string,
      MediaVaultEntry
    >;
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && entry.mediaId) {
        mediaVault.set(id, entry);
      }
    }
  } catch (err) {
    console.error('[Vault] Failed to load local vault:', err);
  }
}

function persistVaultToDisk(): void {
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const obj: Record<string, MediaVaultEntry> = {};
    for (const [k, v] of mediaVault.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(VAULT_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Vault] Failed to persist local vault:', err);
  }
}

loadVaultFromDisk();

// ---------------------------------------------------------------------------
// Security & Validation Helpers
// ---------------------------------------------------------------------------
function isValidDocId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const ipType = net.isIP(lower);
  if (ipType === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
  }
  if (ipType === 6) {
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

function validateExternalMediaUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (isPrivateOrBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractDriveFileIdServer(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z0-9_-]{15,80}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const idParam = parsed.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{10,80}$/.test(idParam)) return idParam;
    const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,80})/);
    if (fileMatch?.[1]) return fileMatch[1];
    const dMatch = parsed.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,80})/);
    if (dMatch?.[1]) return dMatch[1];
  } catch {
    return '';
  }
  return '';
}

function extractYouTubeIdServer(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      return id && /^[a-zA-Z0-9_-]{6,20}$/.test(id) ? id : '';
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{6,20}$/.test(v)) return v;
      const m = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,20})/);
      if (m?.[1]) return m[1];
    }
  } catch {
    return '';
  }
  return '';
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

interface StreamTokenPayload {
  sid: string;
  uid: string;
  mid: string;
  exp: number;
}

function signStreamToken(payload: StreamTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyStreamToken(token: string): StreamTokenPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as StreamTokenPayload;
    if (!payload.sid || !payload.uid || !payload.mid || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Firestore REST Helpers (Starter Tier compatible — enforces firestore.rules)
// ---------------------------------------------------------------------------
function firestoreBaseUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
}

function readRestString(field: Record<string, unknown> | undefined, fallback = ''): string {
  if (!field) return fallback;
  return typeof field.stringValue === 'string' ? field.stringValue : fallback;
}

function readRestInt(field: Record<string, unknown> | undefined, fallback = 0): number {
  if (!field) return fallback;
  if (typeof field.integerValue === 'string' || typeof field.integerValue === 'number') {
    const n = Number(field.integerValue);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function readRestTimestampMs(field: Record<string, unknown> | undefined): number | null {
  if (!field || typeof field.timestampValue !== 'string') return null;
  const ms = Date.parse(field.timestampValue);
  return Number.isFinite(ms) ? ms : null;
}

async function fetchFirestoreDoc(
  collection: string,
  docId: string,
  idToken: string
): Promise<{ exists: boolean; fields?: Record<string, Record<string, unknown>>; status: number }> {
  const res = await fetch(`${firestoreBaseUrl()}/${collection}/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) {
    return { exists: false, status: 404 };
  }
  if (!res.ok) {
    return { exists: false, status: res.status };
  }
  const json = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
  return { exists: true, fields: json.fields ?? {}, status: 200 };
}

async function fetchUserSnapshot(uid: string, idToken: string): Promise<UserRestSnapshot | null> {
  const res = await fetchFirestoreDoc('users', uid, idToken);
  if (!res.exists || !res.fields) return null;
  const f = res.fields;
  const roleRaw = readRestString(f.role, 'subscriber');
  const statusRaw = readRestString(f.status, 'trial');
  return {
    uid: readRestString(f.uid, uid),
    role: roleRaw === 'admin' ? 'admin' : 'subscriber',
    status: (['trial', 'active', 'expired', 'frozen', 'blocked'].includes(statusRaw)
      ? statusRaw
      : 'trial') as UserRestSnapshot['status'],
    trialSecondsRemaining: readRestInt(f.trialSecondsRemaining, 0),
    trialSecondsUsed: readRestInt(f.trialSecondsUsed, 0),
    subscriptionExpiresAtMs: readRestTimestampMs(f.subscriptionExpiresAt),
    updatedAtMs: readRestTimestampMs(f.updatedAt) ?? Date.now(),
  };
}

async function commitUserFieldsWithServerTime(
  uid: string,
  idToken: string,
  fields: Record<string, Record<string, unknown>>,
  fieldPaths: string[]
): Promise<boolean> {
  const docName = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${uid}`;
  const res = await fetch(`${firestoreBaseUrl()}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: docName,
            fields,
          },
          updateMask: {
            fieldPaths,
          },
          updateTransforms: [
            {
              fieldPath: 'updatedAt',
              setToServerValue: 'REQUEST_TIME',
            },
          ],
          currentDocument: { exists: true },
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[Firestore REST] Commit failed (${res.status}):`, errText.slice(0, 300));
    return false;
  }
  return true;
}

async function isVerifiedAdmin(
  uid: string,
  email: string | undefined,
  emailVerified: boolean | undefined,
  idToken: string
): Promise<boolean> {
  if (!emailVerified) return false;
  if (email === BOOTSTRAP_ADMIN_EMAIL) return true;
  const adminDoc = await fetchFirestoreDoc('admins', uid, idToken);
  return adminDoc.exists;
}

// ---------------------------------------------------------------------------
// Google Drive & External HTTP Range Proxy
// ---------------------------------------------------------------------------
interface UpstreamStreamResult {
  ok: boolean;
  status: number;
  response?: globalThis.Response;
  errorCode?: string;
  errorMessage?: string;
}

function buildGoogleDriveUrl(driveFileId: string): { url: string; viaApi: boolean } {
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  if (apiKey) {
    return {
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        driveFileId
      )}?alt=media&key=${encodeURIComponent(apiKey)}`,
      viaApi: true,
    };
  }
  return {
    url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
      driveFileId
    )}&export=download&confirm=t`,
    viaApi: false,
  };
}

function parseDriveConfirmForm(html: string, fallbackId: string): string | null {
  const actionMatch = html.match(/action="([^"]+)"/i);
  const actionUrl = actionMatch?.[1]?.replace(/&amp;/g, '&') || 'https://drive.usercontent.google.com/download';
  const params = new URLSearchParams();
  const inputRegex = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const tags = html.match(inputRegex) || [];
  for (const tag of tags) {
    const nameMatch = tag.match(/name=["']([^"']+)["']/i);
    const valMatch = tag.match(/value=["']([^"']*)["']/i);
    if (nameMatch?.[1]) {
      params.set(nameMatch[1], valMatch?.[1] ?? '');
    }
  }
  if (!params.has('id')) params.set('id', fallbackId);
  if (!params.has('export')) params.set('export', 'download');
  if (!params.has('confirm')) params.set('confirm', 't');
  if (!params.has('uuid') && !html.includes('download-form')) {
    return null;
  }
  const parsedAction = validateExternalMediaUrl(actionUrl);
  if (!parsedAction) return null;
  for (const [k, v] of params.entries()) {
    parsedAction.searchParams.set(k, v);
  }
  return parsedAction.toString();
}

async function openUpstreamMedia(
  entry: MediaVaultEntry,
  rangeHeader: string | undefined,
  signal: AbortSignal
): Promise<UpstreamStreamResult> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept: '*/*',
  };
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  let targetUrl: string;
  if (entry.provider === 'google_drive') {
    if (!entry.driveFileId) {
      return {
        ok: false,
        status: 422,
        errorCode: 'MISSING_DRIVE_ID',
        errorMessage: 'O ID do arquivo do Google Drive não foi encontrado para esta mídia.',
      };
    }
    targetUrl = buildGoogleDriveUrl(entry.driveFileId).url;
  } else {
    const validated = validateExternalMediaUrl(entry.sourceUrl);
    if (!validated) {
      return {
        ok: false,
        status: 422,
        errorCode: 'INVALID_SOURCE_URL',
        errorMessage: 'URL de mídia externa inválida ou bloqueada por política de segurança.',
      };
    }
    targetUrl = validated.toString();
  }

  let upstream = await fetch(targetUrl, {
    headers,
    redirect: 'follow',
    signal,
  });

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();

  // Handle Google Drive interstitial virus scan warning HTML if returned
  if (entry.provider === 'google_drive' && contentType.includes('text/html')) {
    const html = await upstream.text();
    const confirmUrl = parseDriveConfirmForm(html, entry.driveFileId);
    if (confirmUrl) {
      const setCookies = upstream.headers.get('set-cookie');
      if (setCookies) {
        headers.Cookie = setCookies
          .split(',')
          .map((c) => c.split(';')[0].trim())
          .join('; ');
      }
      upstream = await fetch(confirmUrl, {
        headers,
        redirect: 'follow',
        signal,
      });
    } else {
      return {
        ok: false,
        status: 422,
        errorCode: 'DRIVE_PERMISSION_DENIED',
        errorMessage:
          'O Google Drive bloqueou o streaming direto. Verifique se o vídeo está compartilhado como "Qualquer pessoa com o link (Leitor)" ou configure GOOGLE_DRIVE_API_KEY nas variáveis do servidor.',
      };
    }
  }

  const finalContentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (finalContentType.includes('text/html') && !entry.sourceUrl.includes('.m3u8')) {
    return {
      ok: false,
      status: 422,
      errorCode: 'DRIVE_HTML_RESPONSE',
      errorMessage:
        'O link retornou uma página HTML em vez do arquivo de vídeo. Verifique se o link aponta diretamente para um arquivo de vídeo compartilhado publicamente.',
    };
  }

  if (!upstream.ok && upstream.status !== 206) {
    return {
      ok: false,
      status: upstream.status === 403 || upstream.status === 404 ? 422 : 502,
      errorCode: 'UPSTREAM_ERROR',
      errorMessage:
        upstream.status === 403 || upstream.status === 401
          ? 'Acesso negado ao vídeo no Google Drive (403). Altere a permissão do arquivo para "Qualquer pessoa com o link".'
          : upstream.status === 404
            ? 'Arquivo de vídeo não encontrado (404). Verifique o link cadastrado no Painel Administrativo.'
            : `Falha ao obter o fluxo de vídeo (HTTP ${upstream.status}).`,
    };
  }

  return { ok: true, status: upstream.status, response: upstream };
}

function convertSrtToVtt(srt: string): string {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${converted}\n`;
}

// ---------------------------------------------------------------------------
// Express App Setup
// ---------------------------------------------------------------------------
async function bootstrapServer() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, vaultCount: mediaVault.size });
  });

  // -------------------------------------------------------------------------
  // Admin Media Vault Sync (keeps private Drive links off subscriber clients)
  // -------------------------------------------------------------------------
  app.post('/api/admin/media-sync', async (req: Request, res: Response) => {
    try {
      const idToken = extractBearerToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Token ausente.' });
        return;
      }
      const decoded = await adminAuth.verifyIdToken(idToken);
      const okAdmin = await isVerifiedAdmin(
        decoded.uid,
        decoded.email,
        decoded.email_verified,
        idToken
      );
      if (!okAdmin) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Acesso restrito a administradores.' });
        return;
      }

      const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
      let synced = 0;

      for (const raw of items) {
        if (!raw || !isValidDocId(raw.mediaId)) continue;
        const provider: MediaVaultEntry['provider'] =
          raw.provider === 'youtube'
            ? 'youtube'
            : raw.provider === 'gcs_hls'
              ? 'gcs_hls'
              : 'google_drive';
        const rawSourceUrl =
          typeof raw.sourceUrl === 'string' ? raw.sourceUrl.trim().slice(0, 1000) : '';
        const driveFileId =
          provider === 'google_drive'
            ? extractDriveFileIdServer(raw.driveFileId || rawSourceUrl)
            : provider === 'youtube'
              ? extractYouTubeIdServer(raw.driveFileId || rawSourceUrl)
              : '';
        const sourceUrl =
          provider === 'youtube' && driveFileId
            ? `https://www.youtube.com/watch?v=${driveFileId}`
            : rawSourceUrl;

        if (provider === 'google_drive' && !driveFileId) continue;
        if (provider === 'youtube' && !driveFileId) continue;
        if (provider === 'gcs_hls' && !validateExternalMediaUrl(sourceUrl)) continue;

        const mediaType: MediaVaultEntry['mediaType'] =
          raw.mediaType === 'trailer'
            ? 'trailer'
            : raw.mediaType === 'episode'
              ? 'episode'
              : 'movie';

        mediaVault.set(raw.mediaId, {
          mediaId: raw.mediaId,
          mediaType,
          provider,
          driveFileId,
          sourceUrl,
          subtitleUrl:
            typeof raw.subtitleUrl === 'string' ? raw.subtitleUrl.trim().slice(0, 1000) : '',
          qualityLabel:
            typeof raw.qualityLabel === 'string' && raw.qualityLabel.trim()
              ? raw.qualityLabel.trim().slice(0, 40)
              : mediaType === 'trailer'
                ? 'Trailer'
                : '1080p',
          updatedAtIso: new Date().toISOString(),
        });
        synced += 1;
      }

      persistVaultToDisk();
      res.json({ ok: true, synced });
    } catch (err) {
      console.error('[API media-sync]', err);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Erro ao sincronizar mídia.' });
    }
  });

  app.delete('/api/admin/media-vault/:mediaId', async (req: Request, res: Response) => {
    try {
      const idToken = extractBearerToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'UNAUTHORIZED' });
        return;
      }
      const decoded = await adminAuth.verifyIdToken(idToken);
      const okAdmin = await isVerifiedAdmin(
        decoded.uid,
        decoded.email,
        decoded.email_verified,
        idToken
      );
      if (!okAdmin) {
        res.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      const mediaId = String(req.params.mediaId || '');
      if (isValidDocId(mediaId)) {
        mediaVault.delete(mediaId);
        persistVaultToDisk();
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[API media-vault delete]', err);
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // -------------------------------------------------------------------------
  // Playback Authorization & Server-Validated Trial Countdown
  // -------------------------------------------------------------------------
  app.post('/api/playback/authorize', async (req: Request, res: Response) => {
    try {
      const idToken = extractBearerToken(req);
      if (!idToken) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sessão inválida. Faça login novamente.' });
        return;
      }

      const decoded = await adminAuth.verifyIdToken(idToken);
      const mediaId = String(req.body?.mediaId || '');
      const mediaType: ActivePlaybackSession['mediaType'] =
        req.body?.mediaType === 'trailer'
          ? 'trailer'
          : req.body?.mediaType === 'episode'
            ? 'episode'
            : 'movie';
      const isTrailer = mediaType === 'trailer';

      if (!isValidDocId(mediaId)) {
        res.status(400).json({ error: 'INVALID_MEDIA', message: 'Identificador de mídia inválido.' });
        return;
      }

      const userSnap = await fetchUserSnapshot(decoded.uid, idToken);
      if (!userSnap) {
        res.status(403).json({ error: 'USER_NOT_FOUND', message: 'Perfil de assinante não localizado.' });
        return;
      }

      const isAdminAccount =
        userSnap.role === 'admin' ||
        (decoded.email === BOOTSTRAP_ADMIN_EMAIL && decoded.email_verified === true);

      if (!isAdminAccount) {
        if (userSnap.status === 'blocked') {
          res.status(403).json({
            error: 'ACCOUNT_BLOCKED',
            message: 'Sua conta foi bloqueada pela administração.',
          });
          return;
        }
        if (!isTrailer) {
          if (userSnap.status === 'frozen') {
            res.status(403).json({
              error: 'ACCOUNT_FROZEN',
              message: 'Sua assinatura está temporariamente congelada.',
            });
            return;
          }
          if (
            userSnap.status === 'active' &&
            userSnap.subscriptionExpiresAtMs !== null &&
            Date.now() > userSnap.subscriptionExpiresAtMs
          ) {
            await commitUserFieldsWithServerTime(
              decoded.uid,
              idToken,
              { status: { stringValue: 'expired' } },
              ['status']
            );
            res.status(403).json({
              error: 'SUBSCRIPTION_EXPIRED',
              message: 'Sua assinatura venceu. Renove um plano para continuar assistindo.',
            });
            return;
          }
          if (userSnap.status === 'expired') {
            res.status(403).json({
              error: 'TRIAL_OR_SUB_EXPIRED',
              message: 'Seu período de teste gratuito ou assinatura foi encerrado. Assine um plano para continuar.',
            });
            return;
          }
          if (userSnap.status === 'trial' && userSnap.trialSecondsRemaining <= 0) {
            await commitUserFieldsWithServerTime(
              decoded.uid,
              idToken,
              { status: { stringValue: 'expired' } },
              ['status']
            );
            res.status(403).json({
              error: 'TRIAL_EXPIRED',
              message: 'Seus minutos gratuitos de demonstração terminaram. Escolha um plano para continuar.',
            });
            return;
          }
        }
      }

      // Look up media source in server vault; if missing and caller is admin, fetch via REST
      let vaultEntry = mediaVault.get(mediaId);
      if (!vaultEntry && isAdminAccount) {
        const docRes = await fetchFirestoreDoc('mediaSources', mediaId, idToken);
        if (docRes.exists && docRes.fields) {
          const f = docRes.fields;
          const providerRaw = readRestString(f.provider);
          const provider: MediaVaultEntry['provider'] =
            providerRaw === 'youtube'
              ? 'youtube'
              : providerRaw === 'gcs_hls'
                ? 'gcs_hls'
                : 'google_drive';
          const sourceUrl = readRestString(f.sourceUrl);
          const driveFileId =
            provider === 'google_drive'
              ? readRestString(f.driveFileId) || extractDriveFileIdServer(sourceUrl)
              : provider === 'youtube'
                ? readRestString(f.driveFileId) || extractYouTubeIdServer(sourceUrl)
                : '';
          const typeRaw = readRestString(f.mediaType);
          vaultEntry = {
            mediaId,
            mediaType:
              typeRaw === 'trailer' ? 'trailer' : typeRaw === 'episode' ? 'episode' : 'movie',
            provider,
            driveFileId,
            sourceUrl,
            subtitleUrl: readRestString(f.subtitleUrl),
            qualityLabel: readRestString(f.qualityLabel, '1080p'),
            updatedAtIso: new Date().toISOString(),
          };
          mediaVault.set(mediaId, vaultEntry);
          persistVaultToDisk();
        }
      }

      if (!vaultEntry) {
        res.status(424).json({
          error: 'MEDIA_NOT_SYNCED',
          message:
            'A fonte de vídeo desta mídia ainda não foi sincronizada no servidor de streaming. Peça ao administrador para abrir o Painel Administrativo ou re-salvar o link do vídeo.',
        });
        return;
      }

      const accessMode: ActivePlaybackSession['accessMode'] = isTrailer
        ? 'trailer'
        : isAdminAccount
          ? 'admin'
          : userSnap.status === 'active'
            ? 'active'
            : 'trial';

      const sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
      activeSessions.set(sessionId, {
        sessionId,
        uid: decoded.uid,
        role: isAdminAccount ? 'admin' : 'subscriber',
        mediaId,
        mediaType,
        accessMode,
        isPlaying: false,
        lastTickMs: Date.now(),
        lastFirestorePatchMs: userSnap.updatedAtMs,
        uncommittedMs: 0,
        trialSecondsRemaining: userSnap.trialSecondsRemaining,
        trialSecondsUsed: userSnap.trialSecondsUsed,
        revoked: false,
      });

      if (vaultEntry.provider === 'youtube') {
        const ytId =
          vaultEntry.driveFileId || extractYouTubeIdServer(vaultEntry.sourceUrl);
        res.json({
          allowed: true,
          sessionId,
          provider: 'youtube',
          embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
            ytId
          )}?autoplay=1&rel=0`,
          streamUrl: '',
          subtitleUrl: '',
          qualityLabel: vaultEntry.qualityLabel || 'Trailer',
          accessMode,
          trialSecondsRemaining: userSnap.trialSecondsRemaining,
          trialSecondsUsed: userSnap.trialSecondsUsed,
        });
        return;
      }

      const streamToken = signStreamToken({
        sid: sessionId,
        uid: decoded.uid,
        mid: mediaId,
        exp: Date.now() + 2 * 60 * 60 * 1000,
      });

      res.json({
        allowed: true,
        sessionId,
        provider: vaultEntry.provider,
        streamUrl: `/api/media/stream?token=${encodeURIComponent(streamToken)}`,
        subtitleUrl: vaultEntry.subtitleUrl
          ? `/api/media/subtitle?token=${encodeURIComponent(streamToken)}`
          : '',
        qualityLabel: vaultEntry.qualityLabel || (isTrailer ? 'Trailer' : '1080p'),
        accessMode,
        trialSecondsRemaining: userSnap.trialSecondsRemaining,
        trialSecondsUsed: userSnap.trialSecondsUsed,
      });
    } catch (err) {
      console.error('[API playback/authorize]', err);
      res.status(500).json({
        error: 'AUTH_PLAYBACK_ERROR',
        message: 'Não foi possível autorizar a reprodução no momento.',
      });
    }
  });

  app.post('/api/playback/heartbeat', async (req: Request, res: Response) => {
    try {
      const idToken = extractBearerToken(req);
      if (!idToken) {
        res.status(401).json({ allowed: false, reason: 'UNAUTHORIZED' });
        return;
      }
      const decoded = await adminAuth.verifyIdToken(idToken);
      const sessionId = String(req.body?.sessionId || '');
      const state = req.body?.state === 'playing' ? 'playing' : 'paused';

      const session = activeSessions.get(sessionId);
      if (!session || session.uid !== decoded.uid) {
        res.status(404).json({ allowed: false, reason: 'SESSION_NOT_FOUND' });
        return;
      }
      if (session.revoked) {
        res.status(403).json({
          allowed: false,
          reason: session.revokeReason || 'SESSION_REVOKED',
          trialSecondsRemaining: session.trialSecondsRemaining,
        });
        return;
      }

      const now = Date.now();
      const userSnap = await fetchUserSnapshot(decoded.uid, idToken);
      if (!userSnap) {
        session.revoked = true;
        session.revokeReason = 'USER_NOT_FOUND';
        res.status(403).json({ allowed: false, reason: 'USER_NOT_FOUND' });
        return;
      }

      const isAdminAccount = session.role === 'admin';
      const isTrailer = session.mediaType === 'trailer';
      if (!isAdminAccount) {
        if (userSnap.status === 'blocked') {
          session.revoked = true;
          session.revokeReason = 'BLOCKED';
          res.status(403).json({
            allowed: false,
            reason: session.revokeReason,
            trialSecondsRemaining: userSnap.trialSecondsRemaining,
          });
          return;
        }
        if (!isTrailer) {
          if (userSnap.status === 'frozen' || userSnap.status === 'expired') {
            session.revoked = true;
            session.revokeReason = userSnap.status.toUpperCase();
            res.status(403).json({
              allowed: false,
              reason: session.revokeReason,
              trialSecondsRemaining: userSnap.trialSecondsRemaining,
            });
            return;
          }
          if (
            userSnap.status === 'active' &&
            userSnap.subscriptionExpiresAtMs !== null &&
            now > userSnap.subscriptionExpiresAtMs
          ) {
            await commitUserFieldsWithServerTime(
              decoded.uid,
              idToken,
              { status: { stringValue: 'expired' } },
              ['status']
            );
            session.revoked = true;
            session.revokeReason = 'SUBSCRIPTION_EXPIRED';
            res.status(403).json({ allowed: false, reason: 'SUBSCRIPTION_EXPIRED' });
            return;
          }
        }
      }

      // Sync latest balance from Firestore in case admin adjusted trial or upgraded plan
      session.accessMode = isTrailer
        ? 'trailer'
        : isAdminAccount
          ? 'admin'
          : userSnap.status === 'active'
            ? 'active'
            : 'trial';

      if (session.accessMode === 'trial') {
        if (session.isPlaying) {
          const elapsedMs = Math.max(0, Math.min(25_000, now - session.lastTickMs));
          session.uncommittedMs += elapsedMs;
        }

        const wholeSeconds = Math.floor(session.uncommittedMs / 1000);
        const canPatchNow = now - session.lastFirestorePatchMs >= 2500;

        if (wholeSeconds >= 1 && (canPatchNow || wholeSeconds >= userSnap.trialSecondsRemaining)) {
          const delta = Math.min(25, wholeSeconds, userSnap.trialSecondsRemaining);
          if (delta > 0) {
            const nextRemaining = Math.max(0, userSnap.trialSecondsRemaining - delta);
            const nextUsed = userSnap.trialSecondsUsed + delta;
            const nextStatus = nextRemaining === 0 ? 'expired' : 'trial';

            const committed = await commitUserFieldsWithServerTime(
              decoded.uid,
              idToken,
              {
                trialSecondsRemaining: { integerValue: String(nextRemaining) },
                trialSecondsUsed: { integerValue: String(nextUsed) },
                status: { stringValue: nextStatus },
              },
              ['trialSecondsRemaining', 'trialSecondsUsed', 'status']
            );

            if (committed) {
              session.uncommittedMs -= delta * 1000;
              session.lastFirestorePatchMs = now;
              session.trialSecondsRemaining = nextRemaining;
              session.trialSecondsUsed = nextUsed;
            }
          }
        } else {
          session.trialSecondsRemaining = Math.max(
            0,
            userSnap.trialSecondsRemaining - Math.floor(session.uncommittedMs / 1000)
          );
          session.trialSecondsUsed = userSnap.trialSecondsUsed;
        }

        if (session.trialSecondsRemaining <= 0) {
          session.revoked = true;
          session.revokeReason = 'TRIAL_EXPIRED';
          res.status(403).json({
            allowed: false,
            reason: 'TRIAL_EXPIRED',
            trialSecondsRemaining: 0,
            trialSecondsUsed: session.trialSecondsUsed,
          });
          return;
        }
      }

      session.isPlaying = state === 'playing';
      session.lastTickMs = now;

      res.json({
        allowed: true,
        accessMode: session.accessMode,
        trialSecondsRemaining: session.trialSecondsRemaining,
        trialSecondsUsed: session.trialSecondsUsed,
      });
    } catch (err) {
      console.error('[API playback/heartbeat]', err);
      res.status(500).json({ allowed: false, reason: 'INTERNAL_ERROR' });
    }
  });

  app.post('/api/playback/stop', async (req: Request, res: Response) => {
    try {
      const idToken = extractBearerToken(req);
      if (!idToken) {
        res.status(200).json({ ok: true });
        return;
      }
      const decoded = await adminAuth.verifyIdToken(idToken);
      const sessionId = String(req.body?.sessionId || '');
      const session = activeSessions.get(sessionId);
      if (!session || session.uid !== decoded.uid) {
        res.status(200).json({ ok: true });
        return;
      }

      const now = Date.now();
      if (session.accessMode === 'trial' && !session.revoked) {
        if (session.isPlaying) {
          const elapsedMs = Math.max(0, Math.min(25_000, now - session.lastTickMs));
          session.uncommittedMs += elapsedMs;
        }
        const wholeSeconds = Math.floor(session.uncommittedMs / 1000);
        if (wholeSeconds >= 1 && now - session.lastFirestorePatchMs >= 2200) {
          const userSnap = await fetchUserSnapshot(decoded.uid, idToken);
          if (userSnap && userSnap.status === 'trial' && userSnap.trialSecondsRemaining > 0) {
            const delta = Math.min(25, wholeSeconds, userSnap.trialSecondsRemaining);
            const nextRemaining = Math.max(0, userSnap.trialSecondsRemaining - delta);
            const nextUsed = userSnap.trialSecondsUsed + delta;
            await commitUserFieldsWithServerTime(
              decoded.uid,
              idToken,
              {
                trialSecondsRemaining: { integerValue: String(nextRemaining) },
                trialSecondsUsed: { integerValue: String(nextUsed) },
                status: { stringValue: nextRemaining === 0 ? 'expired' : 'trial' },
              },
              ['trialSecondsRemaining', 'trialSecondsUsed', 'status']
            );
          }
        }
      }

      session.isPlaying = false;
      activeSessions.delete(sessionId);
      res.json({ ok: true });
    } catch {
      res.status(200).json({ ok: true });
    }
  });

  // -------------------------------------------------------------------------
  // Probe Media Accessibility (gives exact diagnostics before <video> fails)
  // -------------------------------------------------------------------------
  app.get('/api/media/probe', async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const payload = verifyStreamToken(token);
    if (!payload) {
      res.status(403).json({ ok: false, errorCode: 'INVALID_TOKEN', message: 'Token expirado.' });
      return;
    }
    const session = activeSessions.get(payload.sid);
    if (!session || session.revoked) {
      res.status(403).json({ ok: false, errorCode: 'SESSION_REVOKED', message: 'Sessão encerrada.' });
      return;
    }
    const vaultEntry = mediaVault.get(payload.mid);
    if (!vaultEntry) {
      res.status(404).json({ ok: false, errorCode: 'MEDIA_NOT_FOUND', message: 'Mídia não encontrada.' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const upstream = await openUpstreamMedia(vaultEntry, 'bytes=0-1023', controller.signal);
      if (!upstream.ok || !upstream.response) {
        res.status(upstream.status).json({
          ok: false,
          errorCode: upstream.errorCode,
          message: upstream.errorMessage,
        });
        return;
      }
      const totalSize = parseTotalSizeFromContentRange(
        upstream.response.headers.get('content-range')
      );
      if (totalSize) {
        mediaTotalSizeCache.set(payload.mid, totalSize);
      }
      await upstream.response.body?.cancel().catch(() => undefined);
      res.json({
        ok: true,
        contentType: upstream.response.headers.get('content-type') || 'video/mp4',
        totalBytes: totalSize,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        errorCode: 'PROBE_FAILED',
        message: err instanceof Error ? err.message : 'Falha ao verificar origem do vídeo.',
      });
    }
  });

  // -------------------------------------------------------------------------
  // HTTP Range Streaming Proxy (hides Google Drive links from browser)
  // -------------------------------------------------------------------------
  app.get('/api/media/stream', async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const payload = verifyStreamToken(token);
    if (!payload) {
      res.status(403).json({ error: 'INVALID_STREAM_TOKEN' });
      return;
    }
    const session = activeSessions.get(payload.sid);
    if (!session || session.revoked || session.uid !== payload.uid) {
      res.status(403).json({ error: 'SESSION_REVOKED' });
      return;
    }
    const vaultEntry = mediaVault.get(payload.mid);
    if (!vaultEntry) {
      res.status(404).json({ error: 'MEDIA_NOT_FOUND' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    try {
      const rawRangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const knownTotal = mediaTotalSizeCache.get(payload.mid);
      const boundedRange = clampRangeHeader(rawRangeHeader, knownTotal);

      const upstream = await openUpstreamMedia(vaultEntry, boundedRange, controller.signal);

      if (!upstream.ok || !upstream.response) {
        res.status(upstream.status).json({
          error: upstream.errorCode || 'STREAM_FAILED',
          message: upstream.errorMessage || 'Erro ao carregar vídeo.',
        });
        return;
      }

      const upRes = upstream.response;
      const contentRange = upRes.headers.get('content-range');
      const parsedTotal = parseTotalSizeFromContentRange(contentRange);
      if (parsedTotal) {
        mediaTotalSizeCache.set(payload.mid, parsedTotal);
      }

      const rawType = upRes.headers.get('content-type') || '';
      const resolvedType =
        !rawType || rawType.includes('application/octet-stream') ? 'video/mp4' : rawType;

      res.status(upRes.status === 200 ? 200 : 206);
      res.setHeader('Content-Type', resolvedType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=60');

      const contentLength = upRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (req.method === 'HEAD' || !upRes.body) {
        await upRes.body?.cancel().catch(() => undefined);
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upRes.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.on('error', () => {
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.end();
        }
      });
      nodeStream.pipe(res);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[API media/stream]', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'STREAM_PROXY_ERROR' });
      }
    }
  });

  app.get('/api/media/subtitle', async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const payload = verifyStreamToken(token);
    if (!payload) {
      res.status(403).end();
      return;
    }
    const session = activeSessions.get(payload.sid);
    if (!session || session.revoked) {
      res.status(403).end();
      return;
    }
    const vaultEntry = mediaVault.get(payload.mid);
    if (!vaultEntry || !vaultEntry.subtitleUrl) {
      res.status(404).end();
      return;
    }

    const validated = validateExternalMediaUrl(vaultEntry.subtitleUrl);
    if (!validated) {
      res.status(422).end();
      return;
    }

    try {
      const subRes = await fetch(validated.toString());
      if (!subRes.ok) {
        res.status(404).end();
        return;
      }
      const text = await subRes.text();
      const vtt = text.trimStart().startsWith('WEBVTT') ? text : convertSrtToVtt(text);
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(vtt);
    } catch {
      res.status(502).end();
    }
  });

  // -------------------------------------------------------------------------
  // Vite Dev Middleware or Production Static Assets
  // -------------------------------------------------------------------------
  if (IS_PROD) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Vértice Streaming] Servidor ativo em http://0.0.0.0:${PORT}`);
  });
}

bootstrapServer().catch((err) => {
  console.error('[Vértice Streaming] Falha ao iniciar servidor:', err);
  process.exit(1);
});
