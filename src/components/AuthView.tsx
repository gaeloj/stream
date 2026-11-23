import React, { useState } from 'react';
import { Film, Lock, Mail, User as UserIcon, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  mapAuthErrorMessage,
  registerSubscriberWithEmail,
  requestPasswordReset,
  signInWithEmailAccount,
  signInWithGoogleAccount,
} from '../services/authService';
import type { PlatformCapabilities } from '../platform/deviceAdapter';

type AuthMode = 'login' | 'register' | 'reset';

interface AuthViewProps {
  platform: PlatformCapabilities;
}

export const AuthView: React.FC<AuthViewProps> = ({ platform }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await signInWithGoogleAccount();
    } catch (err) {
      setErrorMsg(mapAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (mode === 'login') {
        await signInWithEmailAccount(email, password);
      } else if (mode === 'register') {
        if (!name.trim()) {
          throw new Error('Informe seu nome completo para criar a conta.');
        }
        await registerSubscriberWithEmail(name, email, password);
        setSuccessMsg('Conta de assinante criada com sucesso. Enviamos um e-mail de verificação.');
      } else {
        await requestPasswordReset(email);
        setSuccessMsg('Link de recuperação enviado. Verifique sua caixa de entrada.');
      }
    } catch (err) {
      setErrorMsg(mapAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#090A0D] text-[#F3F4F6] grid lg:grid-cols-12 items-stretch"
      style={{
        padding: platform.overscanPaddingPx ? `${platform.overscanPaddingPx}px` : undefined,
      }}
    >
      {/* Editorial Cinema Visual Panel */}
      <div className="relative hidden lg:flex lg:col-span-7 flex-col justify-between overflow-hidden border-r border-white/8 bg-[#111318]">
        {!imageFailed ? (
          <img
            src="/src/assets/images/cinema_auth_backdrop_1795398305287.jpg"
            alt="Sala de exibição cinematográfica Vértice"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#181B22] via-[#090A0D] to-[#1F1218]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[#090A0D] via-[#090A0D]/55 to-[#090A0D]/30" />

        <div className="relative z-10 p-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#E11D48] flex items-center justify-center text-white">
              <Film className="w-5 h-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-white">
              VÉRTICE
            </span>
          </div>
          <span className="text-xs text-neutral-300 font-medium">
            {platform.label}
          </span>
        </div>

        <div className="relative z-10 p-10 max-w-2xl space-y-5">
          <p className="text-sm font-medium text-[#FB7185]">
            Plataforma de Streaming Multiplataforma
          </p>
          <h1 className="font-display text-4xl xl:text-5xl font-semibold tracking-tight text-white leading-[1.12] [text-wrap:balance]">
            Cinema e séries sob demanda em qualquer tela.
          </h1>
          <p className="text-base text-neutral-300 leading-relaxed max-w-xl">
            Arquitetura unificada para Web, smartphones, tablets e Smart TVs. Cadastro gratuito com 10 minutos iniciais de reprodução contabilizados apenas durante o vídeo ativo.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-neutral-400">
            <span>Web &amp; Desktop</span>
            <span aria-hidden="true">·</span>
            <span>Samsung Tizen</span>
            <span aria-hidden="true">·</span>
            <span>LG webOS</span>
            <span aria-hidden="true">·</span>
            <span>Android TV &amp; Mobile</span>
          </div>
        </div>
      </div>

      {/* Authentication Workspace */}
      <div className="lg:col-span-5 flex flex-col justify-center px-6 py-12 sm:px-12 xl:px-16">
        <div className="w-full max-w-md mx-auto space-y-8">
          <div className="flex lg:hidden items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#E11D48] flex items-center justify-center text-white">
              <Film className="w-4 h-4" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              VÉRTICE
            </span>
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {mode === 'login' && 'Acesse sua conta'}
              {mode === 'register' && 'Criar conta gratuita'}
              {mode === 'reset' && 'Recuperar senha'}
            </h2>
            <p className="text-sm text-neutral-400">
              {mode === 'login' && 'Entre com Google ou com seu e-mail e senha cadastrados.'}
              {mode === 'register' &&
                'Cadastre-se como assinante. Você navega gratuitamente pelo catálogo e inicia seus 10 minutos de teste apenas ao dar play.'}
              {mode === 'reset' && 'Informe seu e-mail para receber as instruções de redefinição.'}
            </p>
          </div>

          {/* Mode Selector */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#111318] border border-white/8 rounded-lg">
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => handleModeChange('login')}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-[#1F242D] text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => handleModeChange('register')}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-[#1F242D] text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Criar conta
            </button>
            <button
              type="button"
              data-tv-focusable="true"
              onClick={() => handleModeChange('reset')}
              className={`py-2 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'reset'
                  ? 'bg-[#1F242D] text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Recuperar
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#DC2626]/10 border border-[#DC2626]/30 text-sm text-[#FCA5A5]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F87171]" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#16A34A]/10 border border-[#16A34A]/30 text-sm text-[#86EFAC]"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#4ADE80]" />
              <span>{successMsg}</span>
            </div>
          )}

          {mode !== 'reset' && (
            <>
              <button
                type="button"
                data-tv-focusable="true"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg bg-white text-[#090A0D] hover:bg-neutral-200 font-medium text-sm transition-colors disabled:opacity-50"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                <span>Continuar com Google</span>
              </button>

              <div className="relative flex items-center">
                <div className="flex-grow border-t border-white/10" />
                <span className="px-3 text-xs text-neutral-500">ou use e-mail e senha</span>
                <div className="flex-grow border-t border-white/10" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="block text-xs font-medium text-neutral-300">
                  Nome completo
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full pl-10 pr-4 py-2.5 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:border-[#E11D48] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-medium text-neutral-300">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:border-[#E11D48] focus:outline-none"
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-password" className="block text-xs font-medium text-neutral-300">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full pl-10 pr-4 py-2.5 bg-[#111318] border border-white/10 rounded-lg text-sm text-white placeholder:text-neutral-500 focus:border-[#E11D48] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              data-tv-focusable="true"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white font-medium text-sm transition-colors disabled:opacity-50"
            >
              <span>
                {loading
                  ? 'Processando...'
                  : mode === 'login'
                  ? 'Entrar na plataforma'
                  : mode === 'register'
                  ? 'Criar conta de assinante'
                  : 'Enviar e-mail de recuperação'}
              </span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-xs text-neutral-500 leading-relaxed">
            Contas criadas pelo formulário recebem exclusivamente o perfil de <strong className="text-neutral-300 font-medium">Assinante</strong>. Privilégios administrativos são atribuídos somente no servidor.
          </p>
        </div>
      </div>
    </div>
  );
};
