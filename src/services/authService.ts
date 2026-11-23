import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../config/firebase';
import type { AuthProviderType, UserAccount } from '../types/domain';
import { sanitizeText } from '../utils/formatters';

export function mapAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/operation-not-allowed':
      return 'O login por E-mail/Senha ainda não foi ativado no Firebase Console (Authentication → Sign-in method). Use o login com Google ou ative o provedor no console.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha inválidos. Verifique suas credenciais e tente novamente.';
    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.';
    case 'auth/weak-password':
      return 'A senha deve ter pelo menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Informe um endereço de e-mail válido.';
    case 'auth/popup-closed-by-user':
      return 'A janela de login com Google foi fechada antes da conclusão.';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou o pop-up de login. Permita pop-ups para continuar.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas seguidas. Aguarde alguns instantes antes de tentar novamente.';
    default:
      return error instanceof Error ? error.message : 'Não foi possível concluir a autenticação.';
  }
}

export async function signInWithGoogleAccount(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(credential.user, 'google');
  return credential.user;
}

export async function signInWithEmailAccount(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await ensureUserProfile(credential.user, 'password');
  return credential.user;
}

export async function registerSubscriberWithEmail(
  name: string,
  email: string,
  password: string
): Promise<User> {
  const cleanName = sanitizeText(name, 120) || 'Assinante';
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: cleanName });
  try {
    await sendEmailVerification(credential.user);
  } catch {
    // Non-blocking: verification email dispatch should not block profile creation
  }
  await ensureUserProfile(credential.user, 'password', cleanName);
  return credential.user;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

async function resolveDefaultTrialMinutes(): Promise<number> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'platform'));
    if (snap.exists()) {
      const val = snap.data().defaultTrialMinutes;
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        return Math.min(60, Math.floor(val));
      }
    }
  } catch {
    // Fallback safely to 10 minutes if settings/platform is not initialized yet
  }
  return 10;
}

async function isExplicitAdminDoc(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function ensureUserProfile(
  firebaseUser: User,
  providerHint?: AuthProviderType,
  explicitName?: string
): Promise<void> {
  const userPath = `users/${firebaseUser.uid}`;
  const userRef = doc(db, 'users', firebaseUser.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  const isBootstrappedAdmin =
    firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
    firebaseUser.emailVerified === true;

  const hasAdminDoc = firebaseUser.emailVerified ? await isExplicitAdminDoc(firebaseUser.uid) : false;
  const isVerifiedAdmin = isBootstrappedAdmin || hasAdminDoc;

  if (isBootstrappedAdmin && !hasAdminDoc) {
    const adminPath = `admins/${firebaseUser.uid}`;
    try {
      await setDoc(doc(db, 'admins', firebaseUser.uid), {
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? BOOTSTRAP_ADMIN_EMAIL,
        displayName: sanitizeText(firebaseUser.displayName || 'Administrador Principal', 120),
        grantedBy: firebaseUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, adminPath);
    }
  }

  if (existingSnap.exists()) {
    const data = existingSnap.data() as UserAccount;
    try {
      if (isBootstrappedAdmin && data.role !== 'admin') {
        await updateDoc(userRef, {
          role: 'admin',
          status: 'active',
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(userRef, {
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }
    return;
  }

  const detectedProvider: AuthProviderType =
    providerHint ??
    (firebaseUser.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'password');

  const trialMinutes = isVerifiedAdmin ? 0 : await resolveDefaultTrialMinutes();
  const safeName = sanitizeText(
    explicitName || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Assinante',
    120
  );
  const safeEmail = sanitizeText(firebaseUser.email || '', 254);

  const payload = {
    uid: firebaseUser.uid,
    name: safeName,
    email: safeEmail,
    role: isVerifiedAdmin ? 'admin' : 'subscriber',
    status: isVerifiedAdmin ? 'active' : 'trial',
    authProvider: detectedProvider,
    planId: null,
    planName: null,
    trialSecondsRemaining: trialMinutes * 60,
    trialSecondsUsed: 0,
    subscriptionStartedAt: null,
    subscriptionExpiresAt: null,
    lastLoginAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(userRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, userPath);
  }
}

export function subscribeCurrentUserProfile(
  uid: string,
  onData: (profile: UserAccount | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      onData(snapshot.data() as UserAccount);
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

export async function updateBasicAccountName(uid: string, newName: string): Promise<void> {
  const cleanName = sanitizeText(newName, 120);
  if (!cleanName) {
    throw new Error('O nome não pode ficar vazio.');
  }
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      name: cleanName,
      updatedAt: serverTimestamp(),
    });
    if (auth.currentUser && auth.currentUser.uid === uid) {
      await updateProfile(auth.currentUser, { displayName: cleanName });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
