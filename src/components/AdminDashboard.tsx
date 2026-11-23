import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Film,
  Layers,
  Lock,
  LogOut,
  Menu,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Tv,
  Unlock,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { PlatformCapabilities } from '../platform/deviceAdapter';
import {
  adjustUserTrialMinutes,
  assignOrRenewPlan,
  changeSubscriberStatus,
  deleteSubscriberAccount,
  provisionSubscriberAccount,
  removeSubscriptionPlan,
  savePlatformSettings,
  saveSubscriptionPlan,
  subscribeAdminLogs,
  subscribeAllUsers,
  subscribePlans,
  subscribePlatformSettings,
} from '../services/adminService';
import {
  subscribeCategories,
  subscribeMovies,
  subscribeSeries,
  syncAllMediaSourcesToServer,
} from '../services/catalogService';
import { signOutAccount } from '../services/authService';
import type {
  AccountStatus,
  AdminAuditLog,
  Category,
  Movie,
  PlatformSettings,
  Series,
  SubscriptionPlan,
  UserAccount,
} from '../types/domain';
import {
  formatCurrencyBRL,
  formatDateBR,
  formatDateTimeBR,
  formatTrialTime,
  getProviderLabel,
  getStatusLabel,
  getStatusStyles,
} from '../utils/formatters';
import { CatalogMoviesManager } from './admin/CatalogMoviesManager';
import { CatalogSeriesManager } from './admin/CatalogSeriesManager';

interface AdminDashboardProps {
  currentAdmin: UserAccount;
  platform: PlatformCapabilities;
  onSwitchToSubscriberView: () => void;
}

type AdminSection =
  | 'overview'
  | 'movies'
  | 'series'
  | 'subscribers'
  | 'plans'
  | 'logs'
  | 'architecture';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentAdmin,
  platform,
  onSwitchToSubscriberView,
}) => {
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [users, setUsers] = useState<UserAccount[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');

  // Modals
  const [showNewSubModal, setShowNewSubModal] = useState(false);
  const [renewTarget, setRenewTarget] = useState<UserAccount | null>(null);
  const [trialTarget, setTrialTarget] = useState<UserAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserAccount | null>(null);
  const [editingPlan, setEditingPlan] = useState<Partial<SubscriptionPlan> | null>(null);

  // Form states
  const [newSubName, setNewSubName] = useState('');
  const [newSubEmail, setNewSubEmail] = useState('');
  const [newSubTrialMinutes, setNewSubTrialMinutes] = useState(10);
  const [newSubPlanId, setNewSubPlanId] = useState<string>('');
  const [selectedRenewPlanId, setSelectedRenewPlanId] = useState<string>('');
  const [trialAdjustMinutes, setTrialAdjustMinutes] = useState<number>(10);

  // Settings form
  const [settingsPlatformName, setSettingsPlatformName] = useState('Vértice Streaming');
  const [settingsTrialMinutes, setSettingsTrialMinutes] = useState(10);
  const [settingsAllowSelfReg, setSettingsAllowSelfReg] = useState(true);
  const [seedStarterPlans, setSeedStarterPlans] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Plan modal form
  const [planName, setPlanName] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [planPriceReais, setPlanPriceReais] = useState('34.90');
  const [planDays, setPlanDays] = useState('30');
  const [planBenefitsText, setPlanBenefitsText] = useState('');
  const [planActive, setPlanActive] = useState(true);
  const [planOrder, setPlanOrder] = useState('1');

  useEffect(() => {
    let loadedCount = 0;
    const markLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 4) setLoadingData(false);
    };

    const unsubUsers = subscribeAllUsers(
      (items) => {
        setUsers(items);
        markLoaded();
      },
      (err) => {
        setFeedback({ type: 'error', text: err.message });
        markLoaded();
      }
    );

    const unsubPlans = subscribePlans(
      true,
      (items) => {
        setPlans(items);
        markLoaded();
      },
      (err) => {
        setFeedback({ type: 'error', text: err.message });
        markLoaded();
      }
    );

    const unsubLogs = subscribeAdminLogs(
      (items) => {
        setLogs(items);
        markLoaded();
      },
      (err) => {
        setFeedback({ type: 'error', text: err.message });
        markLoaded();
      }
    );

    const unsubSettings = subscribePlatformSettings(
      (docSettings) => {
        setSettings(docSettings);
        if (docSettings) {
          setSettingsPlatformName(docSettings.platformName);
          setSettingsTrialMinutes(docSettings.defaultTrialMinutes);
          setSettingsAllowSelfReg(docSettings.allowSelfRegistration);
          setNewSubTrialMinutes(docSettings.defaultTrialMinutes);
        }
        markLoaded();
      },
      (err) => {
        setFeedback({ type: 'error', text: err.message });
        markLoaded();
      }
    );

    const unsubCategories = subscribeCategories(
      true,
      (items) => setCategories(items),
      (err) => setFeedback({ type: 'error', text: err.message })
    );

    const unsubMovies = subscribeMovies(
      true,
      (items) => setMovies(items),
      (err) => setFeedback({ type: 'error', text: err.message })
    );

    const unsubSeries = subscribeSeries(
      true,
      (items) => setSeriesList(items),
      (err) => setFeedback({ type: 'error', text: err.message })
    );

    void syncAllMediaSourcesToServer();

    return () => {
      unsubUsers();
      unsubPlans();
      unsubLogs();
      unsubSettings();
      unsubCategories();
      unsubMovies();
      unsubSeries();
    };
  }, []);

  const subscribersOnly = useMemo(
    () => users.filter((u) => u.role === 'subscriber'),
    [users]
  );

  const metrics = useMemo(() => {
    const total = subscribersOnly.length;
    const active = subscribersOnly.filter((u) => u.status === 'active').length;
    const trial = subscribersOnly.filter((u) => u.status === 'trial').length;
    const restricted = subscribersOnly.filter(
      (u) => u.status === 'expired' || u.status === 'blocked' || u.status === 'frozen'
    ).length;
    return { total, active, trial, restricted };
  }, [subscribersOnly]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
      const matchesQuery =
        !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [users, searchQuery, statusFilter]);

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await savePlatformSettings(
        currentAdmin,
        {
          platformName: settingsPlatformName,
          defaultTrialMinutes: Number(settingsTrialMinutes),
          allowSelfRegistration: settingsAllowSelfReg,
          seedDefaultPlans: !settings && seedStarterPlans,
        },
        settings
      );
      notify(
        'success',
        settings
          ? 'Configurações globais salvas no Firestore.'
          : 'Plataforma inicializada com sucesso!'
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProvisionSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const plan = plans.find((p) => p.id === newSubPlanId) ?? null;
      await provisionSubscriberAccount(currentAdmin, {
        name: newSubName,
        email: newSubEmail,
        trialMinutes: Number(newSubTrialMinutes),
        plan,
      });
      setShowNewSubModal(false);
      setNewSubName('');
      setNewSubEmail('');
      setNewSubPlanId('');
      notify('success', 'Assinante cadastrado e registrado no log de auditoria.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao cadastrar assinante.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (user: UserAccount, nextStatus: AccountStatus) => {
    try {
      await changeSubscriberStatus(currentAdmin, user, nextStatus);
      notify('success', `Conta ${user.email} atualizada para "${getStatusLabel(nextStatus)}".`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Falha ao atualizar status.');
    }
  };

  const handleConfirmRenew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewTarget) return;
    const plan = plans.find((p) => p.id === selectedRenewPlanId);
    if (!plan) {
      notify('error', 'Selecione um plano válido.');
      return;
    }
    setSubmitting(true);
    try {
      await assignOrRenewPlan(currentAdmin, renewTarget, plan);
      setRenewTarget(null);
      notify('success', `Plano "${plan.name}" aplicado a ${renewTarget.email}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao renovar assinatura.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTrialAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trialTarget) return;
    setSubmitting(true);
    try {
      await adjustUserTrialMinutes(currentAdmin, trialTarget, Number(trialAdjustMinutes));
      setTrialTarget(null);
      notify('success', `Tempo de teste de ${trialTarget.email} atualizado.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao ajustar teste.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      await deleteSubscriberAccount(currentAdmin, deleteTarget);
      setDeleteTarget(null);
      notify('success', 'Conta removida com preservação do log de auditoria.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao excluir conta.');
    } finally {
      setSubmitting(false);
    }
  };

  const openPlanEditor = (plan?: SubscriptionPlan) => {
    if (plan) {
      setEditingPlan(plan);
      setPlanName(plan.name);
      setPlanDesc(plan.description);
      setPlanPriceReais((plan.priceCents / 100).toFixed(2));
      setPlanDays(String(plan.durationDays));
      setPlanBenefitsText(plan.benefits.join('\n'));
      setPlanActive(plan.isActive);
      setPlanOrder(String(plan.sortOrder));
    } else {
      setEditingPlan({});
      setPlanName('');
      setPlanDesc('');
      setPlanPriceReais('34.90');
      setPlanDays('30');
      setPlanBenefitsText('Catálogo completo de filmes e séries\nAcesso Web, Mobile e Smart TV');
      setPlanActive(true);
      setPlanOrder(String(plans.length + 1));
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const parsedReais = Number(planPriceReais.replace(',', '.'));
      const priceCents = Number.isFinite(parsedReais) ? Math.round(parsedReais * 100) : 0;
      const benefits = planBenefitsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      await saveSubscriptionPlan(currentAdmin, {
        id: editingPlan?.id,
        name: planName,
        description: planDesc,
        priceCents,
        durationDays: Number(planDays) || 30,
        benefits,
        isActive: planActive,
        sortOrder: Number(planOrder) || 1,
      });
      setEditingPlan(null);
      notify('success', 'Plano salvo com sucesso.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao salvar plano.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePlan = async (plan: SubscriptionPlan) => {
    try {
      await removeSubscriptionPlan(currentAdmin, plan);
      notify('success', `Plano "${plan.name}" removido.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Erro ao excluir plano.');
    }
  };

  const sectionTitleMap: Record<AdminSection, string> = {
    overview: 'Visão Geral',
    movies: 'Catálogo de Filmes & Links',
    series: 'Séries, Temporadas & Episódios',
    subscribers: 'Gerenciamento de Assinantes',
    plans: 'Planos & Teste Gratuito',
    logs: 'Auditoria Administrativa',
    architecture: 'Arquitetura & Multiplataforma',
  };

  const navItems: { id: AdminSection; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Visão Geral', icon: <Activity className="w-4 h-4" /> },
    { id: 'movies', label: 'Filmes & Links', icon: <Video className="w-4 h-4" /> },
    { id: 'series', label: 'Séries & Episódios', icon: <Tv className="w-4 h-4" /> },
    { id: 'subscribers', label: 'Assinantes', icon: <Users className="w-4 h-4" /> },
    { id: 'plans', label: 'Planos & Teste', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'logs', label: 'Auditoria', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'architecture', label: 'Arquitetura', icon: <Layers className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#090A0D] text-[#F3F4F6] flex">
      {/* Desktop Sidebar (260px) */}
      <aside className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-white/8 bg-[#0E1015]">
        <div className="p-6 border-b border-white/8 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#E11D48] flex items-center justify-center text-white">
            <Film className="w-4 h-4" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            VÉRTICE
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              data-tv-focusable="true"
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                section === item.id
                  ? 'bg-[#181B22] text-white border border-white/10'
                  : 'text-neutral-400 hover:text-white hover:bg-[#14171D]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/8 space-y-3">
          <div className="px-2 space-y-0.5">
            <p className="text-xs font-medium text-white truncate">{currentAdmin.name}</p>
            <p className="text-xs text-neutral-500 truncate">{currentAdmin.email}</p>
          </div>
          <button
            type="button"
            onClick={onSwitchToSubscriberView}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-white/10 bg-[#14171D] hover:bg-[#1C2028] text-neutral-200 transition-colors"
          >
            Visualizar Área Assinante
          </button>
          <button
            type="button"
            onClick={() => signOutAccount()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Encerrar sessão</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-[260px] bg-[#0E1015] border-r border-white/10 flex flex-col">
            <div className="p-5 border-b border-white/8 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-white">VÉRTICE</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                    section === item.id
                      ? 'bg-[#181B22] text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-white/8 space-y-2">
              <button
                type="button"
                onClick={onSwitchToSubscriberView}
                className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-white/10 text-neutral-200"
              >
                Área Assinante
              </button>
              <button
                type="button"
                onClick={() => signOutAccount()}
                className="w-full py-2 px-3 text-xs font-medium rounded-lg bg-[#E11D48] text-white"
              >
                Sair
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-white/8 bg-[#090A0D]/95 px-6 py-4 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-neutral-500">Admin</span>
              <span className="text-neutral-600">/</span>
              <h1 className="font-display font-semibold text-white truncate">
                {sectionTitleMap[section]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {section === 'plans' ? (
              <button
                type="button"
                data-tv-focusable="true"
                onClick={() => openPlanEditor()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Novo Plano</span>
              </button>
            ) : (
              <button
                type="button"
                data-tv-focusable="true"
                onClick={() => setShowNewSubModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Cadastrar Assinante</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-8">
          {feedback && (
            <div
              role="status"
              className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm ${
                feedback.type === 'success'
                  ? 'bg-[#16A34A]/10 border-[#16A34A]/30 text-[#86EFAC]'
                  : 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#FCA5A5]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-[#4ADE80]" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-[#F87171]" />
                )}
                <span>{feedback.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Secure Initial Platform Setup Banner (shown until settings/platform exists) */}
          {!loadingData && !settings && (
            <section className="rounded-xl bg-[#111318] border border-[#E11D48]/40 p-6 space-y-5">
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#FB7185]">
                  Configuração Inicial Obrigatória
                </p>
                <h2 className="font-display text-xl font-semibold text-white">
                  Inicializar parâmetros da plataforma
                </h2>
                <p className="text-sm text-neutral-400">
                  Como primeiro administrador verificado ({currentAdmin.email}), defina o tempo padrão do teste gratuito e crie os planos iniciais no Cloud Firestore.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="grid sm:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Nome da plataforma
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={settingsPlatformName}
                    onChange={(e) => setSettingsPlatformName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Teste gratuito padrão (minutos)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    max={1440}
                    value={settingsTrialMinutes}
                    onChange={(e) => setSettingsTrialMinutes(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={seedStarterPlans}
                      onChange={(e) => setSeedStarterPlans(e.target.checked)}
                      className="rounded border-white/20 bg-[#090A0D]"
                    />
                    <span>Criar planos iniciais</span>
                  </label>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    {submitting ? 'Salvando...' : 'Concluir Setup'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {section === 'overview' && (
            <div className="space-y-8">
              {/* 4-column KPI strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="p-5 rounded-xl bg-[#111318] border border-white/8 space-y-2">
                  <span className="text-xs text-neutral-400">Total de Assinantes</span>
                  <div className="font-mono text-3xl font-semibold text-white tabular-nums">
                    {loadingData ? '—' : metrics.total}
                  </div>
                  <p className="text-xs text-neutral-500">Contas registradas no Firestore</p>
                </div>
                <div className="p-5 rounded-xl bg-[#111318] border border-white/8 space-y-2">
                  <span className="text-xs text-neutral-400">Assinaturas Ativas</span>
                  <div className="font-mono text-3xl font-semibold text-[#4ADE80] tabular-nums">
                    {loadingData ? '—' : metrics.active}
                  </div>
                  <p className="text-xs text-neutral-500">Com plano vigente liberado</p>
                </div>
                <div className="p-5 rounded-xl bg-[#111318] border border-white/8 space-y-2">
                  <span className="text-xs text-neutral-400">Em Teste Gratuito</span>
                  <div className="font-mono text-3xl font-semibold text-[#60A5FA] tabular-nums">
                    {loadingData ? '—' : metrics.trial}
                  </div>
                  <p className="text-xs text-neutral-500 font-mono tabular-nums">
                    Padrão: {settings?.defaultTrialMinutes ?? 10} min por usuário
                  </p>
                </div>
                <div className="p-5 rounded-xl bg-[#111318] border border-white/8 space-y-2">
                  <span className="text-xs text-neutral-400">Vencidas / Restritas</span>
                  <div className="font-mono text-3xl font-semibold text-[#FB923C] tabular-nums">
                    {loadingData ? '—' : metrics.restricted}
                  </div>
                  <p className="text-xs text-neutral-500">Vencidas, congeladas ou bloqueadas</p>
                </div>
              </div>

              {/* Catalog Quick Summary */}
              <div className="grid sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSection('movies')}
                  className="p-5 rounded-xl bg-[#111318] border border-white/8 hover:border-white/20 text-left flex items-center justify-between transition-colors"
                >
                  <div className="space-y-1">
                    <span className="text-xs text-neutral-400">Catálogo de Filmes</span>
                    <div className="font-mono text-2xl font-semibold text-white tabular-nums">
                      {movies.length} filme(s)
                    </div>
                    <p className="text-xs text-neutral-500">
                      Gerenciar filmes, capas e links do Google Drive
                    </p>
                  </div>
                  <Video className="w-5 h-5 text-[#FB7185] shrink-0" />
                </button>
                <button
                  type="button"
                  onClick={() => setSection('series')}
                  className="p-5 rounded-xl bg-[#111318] border border-white/8 hover:border-white/20 text-left flex items-center justify-between transition-colors"
                >
                  <div className="space-y-1">
                    <span className="text-xs text-neutral-400">Catálogo de Séries</span>
                    <div className="font-mono text-2xl font-semibold text-white tabular-nums">
                      {seriesList.length} série(s)
                    </div>
                    <p className="text-xs text-neutral-500">
                      Gerenciar séries, temporadas e links dos episódios
                    </p>
                  </div>
                  <Tv className="w-5 h-5 text-[#FB7185] shrink-0" />
                </button>
              </div>

              <div className="grid lg:grid-cols-12 gap-6">
                {/* Recent Subscribers */}
                <div className="lg:col-span-7 rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-white">
                      Assinantes recentes
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSection('subscribers')}
                      className="text-xs text-[#FB7185] hover:underline"
                    >
                      Ver todos
                    </button>
                  </div>
                  {subscribersOnly.length === 0 ? (
                    <div className="p-8 text-center space-y-3">
                      <p className="text-sm text-neutral-400">
                        Nenhum assinante cadastrado ainda.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowNewSubModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Cadastrar primeiro assinante
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/8">
                      {subscribersOnly.slice(0, 6).map((sub) => (
                        <div
                          key={sub.uid}
                          className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-white/[0.02]"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{sub.name}</p>
                            <p className="text-xs text-neutral-400 truncate">{sub.email}</p>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <span className="font-mono text-xs text-neutral-300 tabular-nums">
                              {formatTrialTime(sub.trialSecondsRemaining)}
                            </span>
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded border ${getStatusStyles(
                                sub.status
                              )}`}
                            >
                              {getStatusLabel(sub.status)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Audit Logs */}
                <div className="lg:col-span-5 rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
                  <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-white">
                      Últimas ações administrativas
                    </h2>
                    <button
                      type="button"
                      onClick={() => setSection('logs')}
                      className="text-xs text-[#FB7185] hover:underline"
                    >
                      Auditoria
                    </button>
                  </div>
                  {logs.length === 0 ? (
                    <div className="p-8 text-center text-sm text-neutral-400">
                      Nenhuma ação administrativa registrada ainda.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/8">
                      {logs.slice(0, 6).map((log) => (
                        <div key={log.id} className="px-6 py-3.5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-[#FB7185]">{log.action}</span>
                            <span className="font-mono text-xs text-neutral-500 tabular-nums">
                              {formatDateTimeBR(log.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs text-neutral-300 leading-relaxed">
                            {log.summary}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === 'subscribers' && (
            <div className="space-y-5">
              {/* Filter & Search Toolbar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nome ou e-mail..."
                    className="w-full pl-10 pr-4 py-2 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:border-[#E11D48] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#111318] border border-white/8 rounded-lg">
                  {(
                    [
                      ['all', 'Todos'],
                      ['trial', 'Teste'],
                      ['active', 'Ativos'],
                      ['expired', 'Vencidos'],
                      ['frozen', 'Congelados'],
                      ['blocked', 'Bloqueados'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        statusFilter === key
                          ? 'bg-[#1F242D] text-white'
                          : 'text-neutral-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* High-Density Subscribers Table */}
              <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/8 text-xs font-medium text-neutral-400">
                        <th className="py-3.5 px-4">Nome</th>
                        <th className="py-3.5 px-4">E-mail</th>
                        <th className="py-3.5 px-4">Cadastro</th>
                        <th className="py-3.5 px-4">Acesso</th>
                        <th className="py-3.5 px-4">Plano</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4 text-right">Teste Restante</th>
                        <th className="py-3.5 px-4 text-right">Vencimento</th>
                        <th className="py-3.5 px-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 text-sm">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-10 text-center text-neutral-400">
                            Nenhum usuário encontrado com os filtros atuais.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isSelf = user.uid === currentAdmin.uid;
                          return (
                            <tr key={user.uid} className="hover:bg-white/[0.02]">
                              <td className="py-3 px-4 font-medium text-white whitespace-nowrap">
                                {user.name}
                                {user.role === 'admin' && (
                                  <span className="ml-2 text-xs text-[#FB7185] font-normal">
                                    (Admin)
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-neutral-300 whitespace-nowrap">
                                {user.email}
                              </td>
                              <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                                {formatDateBR(user.createdAt)}
                              </td>
                              <td className="py-3 px-4 text-xs text-neutral-400 whitespace-nowrap">
                                {getProviderLabel(user.authProvider)}
                              </td>
                              <td className="py-3 px-4 text-xs text-neutral-300 whitespace-nowrap">
                                {user.planName || '—'}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${getStatusStyles(
                                    user.status
                                  )}`}
                                >
                                  {getStatusLabel(user.status)}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-xs text-white tabular-nums whitespace-nowrap">
                                {formatTrialTime(user.trialSecondsRemaining)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                                {formatDateBR(user.subscriptionExpiresAt)}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                {!isSelf && user.role !== 'admin' ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      title="Renovar / Alterar plano"
                                      onClick={() => {
                                        setRenewTarget(user);
                                        setSelectedRenewPlanId(plans[0]?.id || '');
                                      }}
                                      className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-white/10"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Ajustar tempo de teste"
                                      onClick={() => {
                                        setTrialTarget(user);
                                        setTrialAdjustMinutes(
                                          Math.round(user.trialSecondsRemaining / 60)
                                        );
                                      }}
                                      className="p-1.5 rounded-md text-neutral-300 hover:text-white hover:bg-white/10"
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                    </button>
                                    {user.status === 'frozen' ? (
                                      <button
                                        type="button"
                                        title="Descongelar assinatura"
                                        onClick={() =>
                                          handleStatusChange(
                                            user,
                                            user.planId ? 'active' : 'trial'
                                          )
                                        }
                                        className="p-1.5 rounded-md text-[#FBBF24] hover:bg-[#D97706]/15"
                                      >
                                        <PlayCircle className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title="Congelar assinatura"
                                        onClick={() => handleStatusChange(user, 'frozen')}
                                        className="p-1.5 rounded-md text-neutral-300 hover:text-[#FBBF24] hover:bg-white/10"
                                      >
                                        <PauseCircle className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {user.status === 'blocked' ? (
                                      <button
                                        type="button"
                                        title="Desbloquear conta"
                                        onClick={() =>
                                          handleStatusChange(
                                            user,
                                            user.planId ? 'active' : 'trial'
                                          )
                                        }
                                        className="p-1.5 rounded-md text-[#4ADE80] hover:bg-[#16A34A]/15"
                                      >
                                        <Unlock className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        title="Bloquear conta"
                                        onClick={() => handleStatusChange(user, 'blocked')}
                                        className="p-1.5 rounded-md text-neutral-300 hover:text-[#F87171] hover:bg-white/10"
                                      >
                                        <Lock className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Excluir conta"
                                      onClick={() => setDeleteTarget(user)}
                                      className="p-1.5 rounded-md text-neutral-400 hover:text-[#F87171] hover:bg-[#DC2626]/10"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-neutral-600">Protegido</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {section === 'plans' && (
            <div className="space-y-8">
              {/* Global Trial & Platform Config */}
              <section className="rounded-xl bg-[#111318] border border-white/8 p-6 space-y-5">
                <div className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4 text-[#FB7185]" />
                  <h2 className="font-display text-base font-semibold text-white">
                    Configurações Globais de Teste Gratuito e Cadastro
                  </h2>
                </div>

                <form onSubmit={handleSaveSettings} className="grid md:grid-cols-3 gap-5 items-end">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Nome da plataforma
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={80}
                      value={settingsPlatformName}
                      onChange={(e) => setSettingsPlatformName(e.target.value)}
                      className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-neutral-300">
                      Duração padrão do teste gratuito (minutos)
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      max={1440}
                      value={settingsTrialMinutes}
                      onChange={(e) => setSettingsTrialMinutes(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settingsAllowSelfReg}
                        onChange={(e) => setSettingsAllowSelfReg(e.target.checked)}
                        className="rounded border-white/20 bg-[#090A0D]"
                      />
                      <span>Permitir auto-cadastro</span>
                    </label>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {submitting ? 'Salvando...' : 'Salvar configurações'}
                    </button>
                  </div>
                </form>
              </section>

              {/* Plans Grid */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-semibold text-white">
                    Planos cadastrados ({plans.length})
                  </h2>
                </div>

                {plans.length === 0 ? (
                  <div className="p-8 rounded-xl bg-[#111318] border border-white/8 text-center space-y-3">
                    <p className="text-sm text-neutral-400">
                      Nenhum plano configurado ainda.
                    </p>
                    <button
                      type="button"
                      onClick={() => openPlanEditor()}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Criar primeiro plano
                    </button>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-3 gap-5">
                    {plans.map((plan) => (
                      <div
                        key={plan.id}
                        className="p-6 rounded-xl bg-[#111318] border border-white/8 flex flex-col justify-between space-y-5"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-display text-lg font-semibold text-white">
                              {plan.name}
                            </h3>
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded border ${
                                plan.isActive
                                  ? 'text-[#4ADE80] border-[#16A34A]/30 bg-[#16A34A]/10'
                                  : 'text-neutral-400 border-white/10 bg-white/5'
                              }`}
                            >
                              {plan.isActive ? 'Ativo' : 'Inativo'}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-2xl font-semibold text-white tabular-nums">
                              {formatCurrencyBRL(plan.priceCents, plan.currency)}
                            </span>
                            <span className="font-mono text-xs text-neutral-400 tabular-nums">
                              / {plan.durationDays} dias
                            </span>
                          </div>
                          <p className="text-xs text-neutral-400 leading-relaxed">
                            {plan.description}
                          </p>
                          {plan.benefits.length > 0 && (
                            <ul className="pt-2 space-y-1.5 border-t border-white/8 text-xs text-neutral-300">
                              {plan.benefits.map((b, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-[#4ADE80] shrink-0 mt-0.5" />
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="pt-3 border-t border-white/8 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => openPlanEditor(plan)}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-white"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePlan(plan)}
                            className="px-3 py-1.5 text-xs font-medium rounded-md text-[#F87171] hover:bg-[#DC2626]/10"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {section === 'movies' && (
            <CatalogMoviesManager
              currentAdmin={currentAdmin}
              categories={categories}
              movies={movies}
              onNotify={notify}
            />
          )}

          {section === 'series' && (
            <CatalogSeriesManager
              currentAdmin={currentAdmin}
              categories={categories}
              seriesList={seriesList}
              onNotify={notify}
            />
          )}

          {section === 'logs' && (
            <div className="rounded-xl bg-[#111318] border border-white/8 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/8 text-xs font-medium text-neutral-400">
                      <th className="py-3.5 px-4">Data / Hora</th>
                      <th className="py-3.5 px-4">Administrador</th>
                      <th className="py-3.5 px-4">Ação</th>
                      <th className="py-3.5 px-4">Resumo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8 text-sm">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-neutral-400">
                          Nenhuma atividade administrativa registrada ainda.
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono text-xs text-neutral-400 tabular-nums whitespace-nowrap">
                            {formatDateTimeBR(log.createdAt)}
                          </td>
                          <td className="py-3 px-4 text-xs text-neutral-300 whitespace-nowrap">
                            {log.actorEmail}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-[#FB7185] whitespace-nowrap">
                            {log.action}
                          </td>
                          <td className="py-3 px-4 text-xs text-neutral-300">{log.summary}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'architecture' && (
            <div className="grid lg:grid-cols-2 gap-6">
              <section className="p-6 rounded-xl bg-[#111318] border border-white/8 space-y-4">
                <h2 className="font-display text-lg font-semibold text-white">
                  Arquitetura Técnica Implementada (Etapa 1)
                </h2>
                <ul className="space-y-3 text-sm text-neutral-300 leading-relaxed">
                  <li>
                    <strong className="text-white">Autenticação &amp; RBAC:</strong> Firebase Auth (Google Popup + E-mail/Senha + Recuperação) sincronizado com <code className="font-mono text-xs text-[#FB7185]">users/</code> e <code className="font-mono text-xs text-[#FB7185]">admins/</code>. Auto-cadastro força estritamente <code className="font-mono text-xs">role: &quot;subscriber&quot;</code> nas Security Rules.
                  </li>
                  <li>
                    <strong className="text-white">Segurança Firestore:</strong> Regras com isolamento de PII (proprietário ou admin), bloqueio de alteração de <code className="font-mono text-xs">role</code>/<code className="font-mono text-xs">status</code>/<code className="font-mono text-xs">trialSecondsRemaining</code> pelo assinante e trilha imutável em <code className="font-mono text-xs">adminLogs</code>.
                  </li>
                  <li>
                    <strong className="text-white">Camada Multiplataforma:</strong> <code className="font-mono text-xs">deviceAdapter.ts</code> detecta Web, Desktop, Mobile, Samsung Tizen, LG webOS e Android TV com suporte a navegação espacial por D-Pad/controle remoto e margem de overscan.
                  </li>
                </ul>
              </section>

              <section className="p-6 rounded-xl bg-[#111318] border border-white/8 space-y-4">
                <h2 className="font-display text-lg font-semibold text-white">
                  Configurações Externas &amp; Próximas Etapas
                </h2>
                <ul className="space-y-3 text-sm text-neutral-300 leading-relaxed">
                  <li>
                    <strong className="text-white">Firebase Console (Provedor E-mail/Senha):</strong> O login Google já está ativo. Para permitir cadastro e login via E-mail/Senha, habilite o método <em>Email/Password</em> em <em>Firebase Console → Authentication → Sign-in method</em>.
                  </li>
                  <li>
                    <strong className="text-white">Etapa 2 (A seguir):</strong> Catálogo de Filmes, Séries, Temporadas e Episódios + integração segura com Google Drive API via proxy HTTP Range no servidor.
                  </li>
                  <li>
                    <strong className="text-white">Etapas 3 a 5:</strong> Player HTML5 próprio + contador de 10 min validado no servidor, pagamentos Pix/Cartão via webhook e empacotamento dedicado Tizen/webOS/Android TV.
                  </li>
                </ul>
                <div className="pt-2 text-xs text-neutral-400">
                  Ambiente atual detectado: <strong className="text-white">{platform.label}</strong>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* Modal: Cadastrar Assinante */}
      {showNewSubModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                Cadastrar Assinante
              </h3>
              <button
                type="button"
                onClick={() => setShowNewSubModal(false)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProvisionSubscriber} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">Nome</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={newSubName}
                  onChange={(e) => setNewSubName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">E-mail</label>
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={newSubEmail}
                  onChange={(e) => setNewSubEmail(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Teste (minutos)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={newSubTrialMinutes}
                    onChange={(e) => setNewSubTrialMinutes(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Plano inicial (opcional)
                  </label>
                  <select
                    value={newSubPlanId}
                    onChange={(e) => setNewSubPlanId(e.target.value)}
                    className="w-full px-3 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    <option value="">Somente teste gratuito</option>
                    {plans
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.durationDays}d)
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewSubModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Renovar / Aplicar Plano */}
      {renewTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                Renovar / Alterar Plano
              </h3>
              <button
                type="button"
                onClick={() => setRenewTarget(null)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              Assinante: <strong className="text-white">{renewTarget.email}</strong>
            </p>
            <form onSubmit={handleConfirmRenew} className="space-y-4">
              {plans.length === 0 ? (
                <p className="text-xs text-[#FBBF24]">
                  Cadastre pelo menos um plano em &quot;Planos &amp; Teste&quot; antes de aplicar a assinatura.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Selecione o plano
                  </label>
                  <select
                    value={selectedRenewPlanId}
                    onChange={(e) => setSelectedRenewPlanId(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatCurrencyBRL(p.priceCents, p.currency)} ({p.durationDays} dias)
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRenewTarget(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || plans.length === 0}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                >
                  {submitting ? 'Aplicando...' : 'Ativar / Renovar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Ajustar Tempo de Teste */}
      {trialTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                Ajustar Teste Gratuito
              </h3>
              <button
                type="button"
                onClick={() => setTrialTarget(null)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              Assinante: <strong className="text-white">{trialTarget.email}</strong>
            </p>
            <form onSubmit={handleConfirmTrialAdjust} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Saldo restante (minutos)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  required
                  value={trialAdjustMinutes}
                  onChange={(e) => setTrialAdjustMinutes(Number(e.target.value))}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setTrialTarget(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] text-white disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Atualizar saldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Exclusão */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5">
            <h3 className="font-display text-lg font-semibold text-white">
              Excluir conta de assinante?
            </h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              A conta <strong className="text-white">{deleteTarget.email}</strong> será removida do catálogo de assinantes, mantendo o registro imutável da operação em <code className="font-mono text-xs">adminLogs</code>.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmDeleteUser}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white disabled:opacity-50"
              >
                {submitting ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Criar / Editar Plano */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#111318] border border-white/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-white">
                {editingPlan.id ? 'Editar Plano' : 'Novo Plano de Assinatura'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                className="p-1 text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Nome do plano</label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder="Ex: Plano Semestral"
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Preço (R$)
                  </label>
                  <input
                    type="text"
                    required
                    value={planPriceReais}
                    onChange={(e) => setPlanPriceReais(e.target.value)}
                    placeholder="34.90"
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">
                    Duração (dias)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={3650}
                    value={planDays}
                    onChange={(e) => setPlanDays(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-neutral-300">Ordem</label>
                  <input
                    type="number"
                    required
                    min={0}
                    max={1000}
                    value={planOrder}
                    onChange={(e) => setPlanOrder(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">Descrição</label>
                <textarea
                  required
                  minLength={4}
                  maxLength={300}
                  rows={2}
                  value={planDesc}
                  onChange={(e) => setPlanDesc(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Benefícios (um por linha, máximo 10)
                </label>
                <textarea
                  rows={3}
                  value={planBenefitsText}
                  onChange={(e) => setPlanBenefitsText(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#090A0D] border border-white/10 rounded-lg text-sm text-white"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={planActive}
                  onChange={(e) => setPlanActive(e.target.checked)}
                  className="rounded border-white/20 bg-[#090A0D]"
                />
                <span>Plano ativo para contratação</span>
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-white/10 text-neutral-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white disabled:opacity-50"
                >
                  {submitting ? 'Salvando...' : 'Salvar plano'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
