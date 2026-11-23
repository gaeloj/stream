import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocorreu um erro inesperado na aplicação.',
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendlyDetail = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message);
      if (parsed && typeof parsed.error === 'string') {
        if (parsed.error.includes('Quota exceeded')) {
          friendlyDetail =
            'A cota diária gratuita do Firestore foi atingida. A cota é redefinida automaticamente no próximo dia ou pode ser ampliada no Console do Firebase.';
        } else {
          friendlyDetail = `Operação "${parsed.operationType}" em "${parsed.path}": ${parsed.error}`;
        }
      }
    } catch {
      // Keep original string if not JSON
    }

    return (
      <div className="min-h-screen bg-[#090A0D] text-[#F3F4F6] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#111318] border border-white/10 rounded-xl p-8 space-y-5">
          <div className="flex items-center gap-3 text-[#F87171]">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h1 className="font-display text-xl font-semibold text-white">
              Falha na comunicação com os serviços
            </h1>
          </div>
          <p className="text-sm text-neutral-300 leading-relaxed break-words">
            {friendlyDetail}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-[#E11D48] hover:bg-[#BE123C] text-white transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Recarregar aplicação
          </button>
        </div>
      </div>
    );
  }
}
