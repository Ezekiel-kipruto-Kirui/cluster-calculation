import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isFirebaseAuthConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

const requirePrimaryAuth = () => {
  if (!isFirebaseAuthConfigured()) {
    throw new Error("Firebase authentication is not configured.");
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
};

const getSecondaryAppName = () => `secondary-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const isFirebaseAuthReady = () => isFirebaseAuthConfigured();

export const subscribeToAdminAuthState = (callback) => onAuthStateChanged(requirePrimaryAuth(), callback);

export const signInAdminWithEmailPassword = async ({ email, password }) => {
  const auth = requirePrimaryAuth();
  const credential = await signInWithEmailAndPassword(auth, String(email || "").trim(), String(password || ""));
  return credential.user;
};

export const signOutAdminSession = async () => {
  const auth = requirePrimaryAuth();
  await signOut(auth);
};

export const createRegularAdminAuthUser = async ({ email, password, displayName }) => {
  if (!isFirebaseAuthConfigured()) {
    throw new Error("Firebase authentication is not configured.");
  }

  const secondaryApp = initializeApp(firebaseConfig, getSecondaryAppName());
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      String(email || "").trim(),
      String(password || ""),
    );

    if (displayName) {
      await updateProfile(credential.user, { displayName: String(displayName || "").trim() });
    }

    return {
      uid: credential.user.uid,
      email: credential.user.email || String(email || "").trim(),
      displayName: credential.user.displayName || String(displayName || "").trim(),
    };
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch {
      // ignore secondary auth sign-out failures
    }
    await deleteApp(secondaryApp);
  }
};

