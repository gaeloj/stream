import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Film, Play, Tv } from 'lucide-react';

interface CatalogCarouselRowProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const CatalogCarouselRow: React.FC<CatalogCarouselRowProps> = ({
  title,
  subtitle,
  children,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);

  const scrollTrack = (direction: 'left' | 'right') => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(320, Math.round(el.clientWidth * 0.8));
    el.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth',
    });
  };

  return (
    <section className="space-y-3 group/row relative">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-white tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <span className="text-xs text-neutral-400 shrink-0">{subtitle}</span>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => scrollTrack('left')}
          aria-label={`Rolar ${title} para a esquerda`}
          className="hidden md:flex items-center justify-center absolute left-0 top-0 bottom-8 z-20 w-10 bg-gradient-to-r from-[#090A0D]/90 to-transparent text-white/80 hover:text-white opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div
          ref={trackRef}
          className="flex items-stretch gap-3.5 sm:gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory no-scrollbar py-2 px-1"
        >
          {children}
        </div>

        <button
          type="button"
          onClick={() => scrollTrack('right')}
          aria-label={`Rolar ${title} para a direita`}
          className="hidden md:flex items-center justify-center absolute right-0 top-0 bottom-8 z-20 w-10 bg-gradient-to-l from-[#090A0D]/90 to-transparent text-white/80 hover:text-white opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>
    </section>
  );
};

interface PosterCardProps {
  title: string;
  meta: string;
  posterUrl?: string;
  bannerUrl?: string;
  kind: 'movie' | 'series';
  ageRating?: string;
  onClick: () => void;
  layout?: 'carousel' | 'grid';
}

export const PosterCard: React.FC<PosterCardProps> = ({
  title,
  meta,
  posterUrl,
  bannerUrl,
  kind,
  ageRating,
  onClick,
  layout = 'carousel',
}) => {
  const imageSrc = posterUrl || bannerUrl || '';
  const sizeClass =
    layout === 'carousel'
      ? 'w-[148px] sm:w-[172px] md:w-[190px] lg:w-[204px] shrink-0 snap-start'
      : 'w-full';

  return (
    <button
      type="button"
      data-tv-focusable="true"
      onClick={onClick}
      className={`${sizeClass} group text-left space-y-2 focus:outline-none`}
    >
      <div className="aspect-[2/3] w-full rounded-lg overflow-hidden bg-[#14171F] border border-white/10 group-hover:border-white/40 group-hover:scale-[1.03] transition-transform duration-200 relative">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2.5 p-4 bg-gradient-to-b from-[#1A1F2B] to-[#0D1017] text-neutral-500">
            {kind === 'movie' ? (
              <Film className="w-7 h-7 text-neutral-400" />
            ) : (
              <Tv className="w-7 h-7 text-neutral-400" />
            )}
            <span className="text-xs font-medium text-center text-neutral-300 line-clamp-3">
              {title}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="w-8 h-8 rounded-full bg-white text-[#090A0D] flex items-center justify-center shadow">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </span>
            {ageRating && (
              <span className="font-mono text-[11px] font-medium text-neutral-200 px-1.5 py-0.5 rounded border border-white/30 bg-black/50">
                {ageRating === 'L' ? 'Livre' : `${ageRating}+`}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-0.5 px-0.5">
        <h3 className="text-sm font-medium text-white truncate group-hover:text-white">
          {title}
        </h3>
        <p className="text-xs text-neutral-400 truncate">{meta}</p>
      </div>
    </button>
  );
};
