import { useEffect } from 'react';
import type { DeviceTarget } from '../types/domain';

export interface PlatformCapabilities {
  target: DeviceTarget;
  label: string;
  isTV: boolean;
  isTouch: boolean;
  overscanPaddingPx: number;
  supportsHover: boolean;
}

declare global {
  interface Window {
    tizen?: unknown;
    webOS?: unknown;
  }
}

export function detectPlatform(): PlatformCapabilities {
  if (typeof window === 'undefined') {
    return {
      target: 'web',
      label: 'Web Browser',
      isTV: false,
      isTouch: false,
      overscanPaddingPx: 0,
      supportsHover: true,
    };
  }

  const ua = navigator.userAgent.toLowerCase();

  if (typeof window.tizen !== 'undefined' || ua.includes('tizen')) {
    return {
      target: 'tizen',
      label: 'Samsung Tizen TV',
      isTV: true,
      isTouch: false,
      overscanPaddingPx: 48,
      supportsHover: false,
    };
  }

  if (typeof window.webOS !== 'undefined' || ua.includes('webos') || ua.includes('web0s')) {
    return {
      target: 'webos',
      label: 'LG webOS TV',
      isTV: true,
      isTouch: false,
      overscanPaddingPx: 48,
      supportsHover: false,
    };
  }

  if (ua.includes('android tv') || ua.includes('googletv') || ua.includes('aftb') || ua.includes('bravia')) {
    return {
      target: 'android-tv',
      label: 'Android TV / Google TV',
      isTV: true,
      isTouch: false,
      overscanPaddingPx: 48,
      supportsHover: false,
    };
  }

  if (/iphone|ipad|ipod/.test(ua)) {
    return {
      target: 'ios',
      label: 'iOS / iPadOS',
      isTV: false,
      isTouch: true,
      overscanPaddingPx: 0,
      supportsHover: false,
    };
  }

  if (ua.includes('android')) {
    return {
      target: 'android',
      label: 'Android Mobile / Tablet',
      isTV: false,
      isTouch: true,
      overscanPaddingPx: 0,
      supportsHover: false,
    };
  }

  if (ua.includes('windows') || ua.includes('macintosh') || ua.includes('linux')) {
    return {
      target: 'desktop',
      label: 'Desktop Web',
      isTV: false,
      isTouch: false,
      overscanPaddingPx: 0,
      supportsHover: true,
    };
  }

  return {
    target: 'web',
    label: 'Modern Web',
    isTV: false,
    isTouch: false,
    overscanPaddingPx: 0,
    supportsHover: true,
  };
}

export type RemoteAction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SELECT' | 'BACK' | 'PLAY_PAUSE';

export function mapRemoteKeyEvent(event: KeyboardEvent): RemoteAction | null {
  switch (event.key) {
    case 'ArrowUp':
      return 'UP';
    case 'ArrowDown':
      return 'DOWN';
    case 'ArrowLeft':
      return 'LEFT';
    case 'ArrowRight':
      return 'RIGHT';
    case 'Enter':
      return 'SELECT';
    case 'Escape':
    case 'Backspace':
    case 'XF86Back':
    case 'GoBack':
      return 'BACK';
    case 'MediaPlayPause':
      return 'PLAY_PAUSE';
    default:
      break;
  }

  // Samsung Tizen Return (10009) and LG webOS Back (461)
  if (event.keyCode === 10009 || event.keyCode === 461) {
    return 'BACK';
  }
  if (event.keyCode === 415 || event.keyCode === 19 || event.keyCode === 10252) {
    return 'PLAY_PAUSE';
  }
  return null;
}

/**
 * Spatial focus navigation layer prepared for Smart TV remotes (Tizen, webOS, Android TV).
 * Moves focus linearly or spatially across `[data-tv-focusable="true"]` interactive elements.
 */
export function useTVSpatialNavigation(enabled = true, onBack?: () => void): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const action = mapRemoteKeyEvent(event);
      if (!action) return;

      if (action === 'BACK' && !isTextInput && onBack) {
        event.preventDefault();
        onBack();
        return;
      }

      if (isTextInput) return;

      if (action === 'UP' || action === 'DOWN' || action === 'LEFT' || action === 'RIGHT') {
        const focusables = Array.from(
          document.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]:not([disabled])')
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) return;

        const currentIndex = target ? focusables.indexOf(target) : -1;
        if (currentIndex === -1) {
          focusables[0].focus();
          return;
        }

        event.preventDefault();
        const delta = action === 'DOWN' || action === 'RIGHT' ? 1 : -1;
        const nextIndex = (currentIndex + delta + focusables.length) % focusables.length;
        focusables[nextIndex].focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onBack]);
}
