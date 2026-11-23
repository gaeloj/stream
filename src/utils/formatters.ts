import type { Timestamp } from 'firebase/firestore';
import type { AccountStatus, AuthProviderType } from '../types/domain';

export function formatTrialTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDateBR(ts?: Timestamp | null): string {
  if (!ts) return '—';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatDateTimeBR(ts?: Timestamp | null): string {
  if (!ts) return '—';
  try {
    const date = ts.toDate();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatCurrencyBRL(priceCents: number, currency: 'BRL' | 'USD' = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format(priceCents / 100);
}

export function getStatusLabel(status: AccountStatus): string {
  switch (status) {
    case 'trial':
      return 'Teste gratuito';
    case 'active':
      return 'Assinatura ativa';
    case 'expired':
      return 'Assinatura vencida';
    case 'frozen':
      return 'Congelado';
    case 'blocked':
      return 'Bloqueado';
    default:
      return status;
  }
}

export function getStatusStyles(status: AccountStatus): string {
  switch (status) {
    case 'active':
      return 'text-[#4ADE80] border-[#16A34A]/30 bg-[#16A34A]/10';
    case 'trial':
      return 'text-[#60A5FA] border-[#2563EB]/30 bg-[#2563EB]/10';
    case 'frozen':
      return 'text-[#FBBF24] border-[#D97706]/30 bg-[#D97706]/10';
    case 'expired':
      return 'text-[#FB923C] border-[#EA580C]/30 bg-[#EA580C]/10';
    case 'blocked':
      return 'text-[#F87171] border-[#DC2626]/30 bg-[#DC2626]/10';
    default:
      return 'text-neutral-300 border-neutral-700 bg-neutral-800/40';
  }
}

export function getProviderLabel(provider: AuthProviderType): string {
  switch (provider) {
    case 'google':
      return 'Google';
    case 'password':
      return 'E-mail/Senha';
    case 'admin_provisioned':
      return 'Pré-cadastro Admin';
    default:
      return provider;
  }
}

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}
