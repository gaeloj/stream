import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import type {
  AccountStatus,
  AdminAuditLog,
  PlatformSettings,
  SubscriptionPlan,
  UserAccount,
} from '../types/domain';
import { getStatusLabel, sanitizeText } from '../utils/formatters';

function generateSafeId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw}`;
}

export function subscribePlatformSettings(
  onData: (settings: PlatformSettings | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'settings/platform';
  return onSnapshot(
    doc(db, 'settings', 'platform'),
    (snap) => {
      onData(snap.exists() ? (snap.data() as PlatformSettings) : null);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.GET, path);
        } catch (wrapped) {
          onError(wrapped as Error);
        }
      } else {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  );
}

export async function savePlatformSettings(
  actor: UserAccount,
  input: {
    platformName: string;
    defaultTrialMinutes: number;
    allowSelfRegistration: boolean;
    seedDefaultPlans?: boolean;
  },
  existingSettings: PlatformSettings | null
): Promise<void> {
  const batch = writeBatch(db);
  const settingsRef = doc(db, 'settings', 'platform');
  const safeName = sanitizeText(input.platformName, 80) || 'Vértice Streaming';
  const safeMinutes = Math.max(0, Math.min(1440, Math.floor(input.defaultTrialMinutes)));

  if (!existingSettings) {
    batch.set(settingsRef, {
      platformName: safeName,
      defaultTrialMinutes: safeMinutes,
      allowSelfRegistration: input.allowSelfRegistration,
      initializedByUid: actor.uid,
      initializedByEmail: sanitizeText(actor.email, 254),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(settingsRef, {
      platformName: safeName,
      defaultTrialMinutes: safeMinutes,
      allowSelfRegistration: input.allowSelfRegistration,
      updatedAt: serverTimestamp(),
    });
  }

  if (!existingSettings && input.seedDefaultPlans) {
    const starterPlans = [
      {
        name: 'Plano Mensal',
        description: 'Acesso completo ao catálogo de filmes e séries em até 4K por 30 dias.',
        priceCents: 3490,
        currency: 'BRL' as const,
        durationDays: 30,
        benefits: [
          'Catálogo completo de filmes e séries',
          'Reprodução em Web, Mobile e Smart TV',
          'Qualidade adaptativa até Full HD / 4K',
        ],
        isActive: true,
        sortOrder: 1,
      },
      {
        name: 'Plano Trimestral',
        description: 'Economia recorrente com 90 dias contínuos de acesso multiplataforma.',
        priceCents: 9490,
        currency: 'BRL' as const,
        durationDays: 90,
        benefits: [
          'Economia de 10% frente ao plano mensal',
          'Acesso completo em Smart TVs Tizen, webOS e Android TV',
          'Histórico sincronizado e Continuar Assistindo',
        ],
        isActive: true,
        sortOrder: 2,
      },
      {
        name: 'Plano Anual',
        description: 'Um ano inteiro de entretenimento com o menor custo mensal da plataforma.',
        priceCents: 33900,
        currency: 'BRL' as const,
        durationDays: 365,
        benefits: [
          '365 dias de acesso ininterrupto',
          'Economia superior a 19% no ciclo anual',
          'Prioridade em lançamentos e suporte dedicado',
        ],
        isActive: true,
        sortOrder: 3,
      },
    ];

    for (const plan of starterPlans) {
      const planId = generateSafeId('plan');
      batch.set(doc(db, 'plans', planId), {
        ...plan,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  const logId = generateSafeId('log');
  batch.set(doc(db, 'adminLogs', logId), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: existingSettings ? 'UPDATE_SETTINGS' : 'INITIALIZE_PLATFORM',
    targetType: 'settings',
    targetId: 'platform',
    summary: sanitizeText(
      existingSettings
        ? `Configurações atualizadas: teste padrão ${safeMinutes} min, auto-cadastro ${input.allowSelfRegistration ? 'ativo' : 'desativado'}.`
        : `Configuração inicial concluída por ${actor.email} (${safeMinutes} min de teste padrão).`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/platform');
  }
}

export function subscribeAllUsers(
  onData: (users: UserAccount[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'users';
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as UserAccount);
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

export function subscribePlans(
  includeInactive: boolean,
  onData: (plans: SubscriptionPlan[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'plans';
  const q = includeInactive
    ? query(collection(db, 'plans'), orderBy('sortOrder', 'asc'))
    : query(collection(db, 'plans'), where('isActive', '==', true));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<SubscriptionPlan, 'id'>),
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

export function subscribeAdminLogs(
  onData: (logs: AdminAuditLog[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'adminLogs';
  const q = query(collection(db, 'adminLogs'), orderBy('createdAt', 'desc'), limit(60));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AdminAuditLog, 'id'>),
      }));
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

export async function provisionSubscriberAccount(
  actor: UserAccount,
  input: {
    name: string;
    email: string;
    trialMinutes: number;
    plan?: SubscriptionPlan | null;
  }
): Promise<void> {
  const subId = generateSafeId('sub');
  const safeName = sanitizeText(input.name, 120);
  const safeEmail = sanitizeText(input.email.toLowerCase(), 254);
  if (!safeName || !safeEmail.includes('@')) {
    throw new Error('Informe nome e e-mail válidos para cadastrar o assinante.');
  }

  const trialSeconds = Math.max(0, Math.min(1440, Math.floor(input.trialMinutes))) * 60;
  const batch = writeBatch(db);
  const nowMs = Date.now();
  const hasPlan = Boolean(input.plan);

  const startedAt = hasPlan ? Timestamp.fromMillis(nowMs) : null;
  const expiresAt =
    hasPlan && input.plan
      ? Timestamp.fromMillis(nowMs + input.plan.durationDays * 86400 * 1000)
      : null;

  batch.set(doc(db, 'users', subId), {
    uid: subId,
    name: safeName,
    email: safeEmail,
    role: 'subscriber',
    status: hasPlan ? 'active' : 'trial',
    authProvider: 'admin_provisioned',
    planId: input.plan?.id ?? null,
    planName: input.plan?.name ?? null,
    trialSecondsRemaining: trialSeconds,
    trialSecondsUsed: 0,
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: expiresAt,
    lastLoginAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'PROVISION_SUBSCRIBER',
    targetType: 'user',
    targetId: subId,
    summary: sanitizeText(
      `Assinante cadastrado: ${safeName} (${safeEmail}) — ${
        hasPlan && input.plan ? `Plano ${input.plan.name}` : `${input.trialMinutes} min de teste`
      }.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${subId}`);
  }
}

export async function changeSubscriberStatus(
  actor: UserAccount,
  targetUser: UserAccount,
  newStatus: AccountStatus
): Promise<void> {
  if (targetUser.uid === actor.uid) {
    throw new Error('Você não pode alterar o status da sua própria conta administrativa.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', targetUser.uid), {
    status: newStatus,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: `SET_STATUS_${newStatus.toUpperCase()}`,
    targetType: 'user',
    targetId: targetUser.uid,
    summary: sanitizeText(
      `Status de ${targetUser.email} alterado de "${getStatusLabel(targetUser.status)}" para "${getStatusLabel(newStatus)}".`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function assignOrRenewPlan(
  actor: UserAccount,
  targetUser: UserAccount,
  plan: SubscriptionPlan
): Promise<void> {
  const nowMs = Date.now();
  const baseMs =
    targetUser.subscriptionExpiresAt &&
    targetUser.subscriptionExpiresAt.toMillis() > nowMs &&
    targetUser.status === 'active'
      ? targetUser.subscriptionExpiresAt.toMillis()
      : nowMs;

  const newExpiresAt = Timestamp.fromMillis(baseMs + plan.durationDays * 86400 * 1000);
  const startedAt = targetUser.subscriptionStartedAt ?? Timestamp.fromMillis(nowMs);

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', targetUser.uid), {
    status: 'active',
    planId: plan.id,
    planName: sanitizeText(plan.name, 120),
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: newExpiresAt,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'RENEW_OR_ASSIGN_PLAN',
    targetType: 'user',
    targetId: targetUser.uid,
    summary: sanitizeText(
      `Plano "${plan.name}" (+${plan.durationDays} dias) aplicado à conta ${targetUser.email}.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function adjustUserTrialMinutes(
  actor: UserAccount,
  targetUser: UserAccount,
  minutes: number
): Promise<void> {
  const safeSeconds = Math.max(0, Math.min(86400, Math.floor(minutes * 60)));
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', targetUser.uid), {
    trialSecondsRemaining: safeSeconds,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'ADJUST_TRIAL_BALANCE',
    targetType: 'user',
    targetId: targetUser.uid,
    summary: sanitizeText(
      `Saldo de teste gratuito de ${targetUser.email} ajustado para ${minutes} minutos.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUser.uid}`);
  }
}

export async function deleteSubscriberAccount(
  actor: UserAccount,
  targetUser: UserAccount
): Promise<void> {
  if (targetUser.uid === actor.uid) {
    throw new Error('Não é possível excluir sua própria conta administrativa.');
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, 'users', targetUser.uid));
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_USER',
    targetType: 'user',
    targetId: targetUser.uid,
    summary: sanitizeText(
      `Conta ${targetUser.name} (${targetUser.email}) removida pelo administrador.`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${targetUser.uid}`);
  }
}

export async function saveSubscriptionPlan(
  actor: UserAccount,
  planInput: {
    id?: string;
    name: string;
    description: string;
    priceCents: number;
    durationDays: number;
    benefits: string[];
    isActive: boolean;
    sortOrder: number;
  }
): Promise<void> {
  const isEdit = Boolean(planInput.id);
  const planId = planInput.id || generateSafeId('plan');
  const safeName = sanitizeText(planInput.name, 80);
  const safeDesc = sanitizeText(planInput.description, 300);
  const safeBenefits = planInput.benefits
    .map((b) => sanitizeText(b, 160))
    .filter((b) => b.length > 0)
    .slice(0, 10);

  if (safeName.length < 2 || safeDesc.length < 4) {
    throw new Error('Nome e descrição do plano devem ser preenchidos corretamente.');
  }

  const batch = writeBatch(db);
  const planRef = doc(db, 'plans', planId);

  if (isEdit) {
    batch.update(planRef, {
      name: safeName,
      description: safeDesc,
      priceCents: Math.max(0, Math.min(10000000, Math.round(planInput.priceCents))),
      currency: 'BRL',
      durationDays: Math.max(1, Math.min(3650, Math.round(planInput.durationDays))),
      benefits: safeBenefits,
      isActive: planInput.isActive,
      sortOrder: Math.max(0, Math.min(1000, Math.round(planInput.sortOrder))),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(planRef, {
      name: safeName,
      description: safeDesc,
      priceCents: Math.max(0, Math.min(10000000, Math.round(planInput.priceCents))),
      currency: 'BRL',
      durationDays: Math.max(1, Math.min(3650, Math.round(planInput.durationDays))),
      benefits: safeBenefits,
      isActive: planInput.isActive,
      sortOrder: Math.max(0, Math.min(1000, Math.round(planInput.sortOrder))),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: isEdit ? 'UPDATE_PLAN' : 'CREATE_PLAN',
    targetType: 'plan',
    targetId: planId,
    summary: sanitizeText(
      `${isEdit ? 'Plano atualizado' : 'Plano criado'}: ${safeName} (${planInput.durationDays} dias).`,
      400
    ),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `plans/${planId}`);
  }
}

export async function removeSubscriptionPlan(
  actor: UserAccount,
  plan: SubscriptionPlan
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'plans', plan.id));
  batch.set(doc(db, 'adminLogs', generateSafeId('log')), {
    actorUid: actor.uid,
    actorEmail: sanitizeText(actor.email, 254),
    action: 'DELETE_PLAN',
    targetType: 'plan',
    targetId: plan.id,
    summary: sanitizeText(`Plano "${plan.name}" excluído.`, 400),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `plans/${plan.id}`);
  }
}
