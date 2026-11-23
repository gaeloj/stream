import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Film } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthView } from './components/AuthView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SubscriberShell } from './components/SubscriberShell';
import { auth, testFirestoreConnection } from './config/firebase';
import { detectPlatform, useTVSpatialNavigation } from './platform/deviceAdapter';
import { ensureUserProfile, subscribeCurrentUserProfile } from './services/authService';
import type { UserAccount } from './types/domain';

function AppContent() {
  const platform = useMemo(() => detectPlatform(), []);
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserAccount | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [viewAsSubscriber, setViewAsSubscriber] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  useTVSpatialNavigation(true);

  if (fatalError) {
    throw fatalError;
  }

  useEffect(() => {
    void testFirestoreConnection();

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (!user) {
        setProfile(null);
        setProfileLoading(false);
        setViewAsSubscriber(false);
        return;
      }

      setProfileLoading(true);
      try {
        await ensureUserProfile(user);
      } catch (err) {
        setFatalError(err instanceof Error ? err : new Error(String(err)));
        setProfileLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    const unsubscribeProfile = subscribeCurrentUserProfile(
      firebaseUser.uid,
      (loadedProfile) => {
        setProfile(loadedProfile);
        setProfileLoading(false);
      },
      (err) => {
        setFatalError(err);
        setProfileLoading(false);
      }
    );

    return () => unsubscribeProfile();
  }, [authReady, firebaseUser]);

  if (!authReady || (firebaseUser && profileLoading)) {
    return (
      <div className="min-h-screen bg-[#090A0D] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-[#E11D48] flex items-center justify-center text-white">
          <Film className="w-5 h-5" />
        </div>
        <p className="text-sm text-neutral-400">Carregando sessão...</p>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return <AuthView platform={platform} />;
  }

  if (profile.role === 'admin' && !viewAsSubscriber) {
    return (
      <AdminDashboard
        currentAdmin={profile}
        platform={platform}
        onSwitchToSubscriberView={() => setViewAsSubscriber(true)}
      />
    );
  }

  return (
    <SubscriberShell
      profile={profile}
      platform={platform}
      onOpenAdmin={
        profile.role === 'admin' ? () => setViewAsSubscriber(false) : undefined
      }
    />
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
