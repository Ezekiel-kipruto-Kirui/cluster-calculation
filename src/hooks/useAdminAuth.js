import { useCallback, useEffect, useMemo, useState } from "react";
import { SUPER_ADMIN_EMAIL } from "../config/appConfig";
import {
  createRegularAdminAuthUser,
  isFirebaseAuthReady,
  signInAdminWithEmailPassword,
  signOutAdminSession,
  subscribeToAdminAuthState,
} from "../lib/firebaseAuth";
import { fetchAdminProfile, upsertAdminProfile } from "../lib/realtimeDb";

const parseAuthError = (error) => {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("invalid-credential")) return "Invalid email or password.";
  if (code.includes("user-not-found")) return "Admin account was not found.";
  if (code.includes("wrong-password")) return "Invalid email or password.";
  if (code.includes("email-already-in-use")) return "Email is already registered.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("configuration-not-found")) {
    return "Firebase Auth provider is not configured. Enable Email/Password sign-in in Firebase Console.";
  }
  return error?.message || "Authentication request failed.";
};

export const useAdminAuth = () => {
  const [adminUser, setAdminUser] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authWorking, setAuthWorking] = useState(false);
  const [authError, setAuthError] = useState("");

  const firebaseAuthReady = useMemo(() => isFirebaseAuthReady(), []);

  const ensureProfileForUser = useCallback(async (user) => {
    let profile = await fetchAdminProfile(user.uid);
    if (profile) return profile;

    const superEmail = String(SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
    const userEmail = String(user?.email || "").trim().toLowerCase();
    if (superEmail && userEmail && userEmail === superEmail) {
      profile = await upsertAdminProfile(user.uid, {
        email: user.email || "",
        name: user.displayName || "Super Admin",
        role: "super",
        active: true,
      });
      return profile;
    }

    return null;
  }, []);

  useEffect(() => {
    if (!firebaseAuthReady) {
      setAuthLoading(false);
      setAuthError("Firebase auth is not configured.");
      return () => {};
    }

    const unsubscribe = subscribeToAdminAuthState(async (user) => {
      setAuthLoading(true);
      try {
        if (!user) {
          setAdminUser(null);
          setAdminProfile(null);
          setAuthError("");
          return;
        }

        const profile = await ensureProfileForUser(user);
        if (!profile || profile.active === false) {
          await signOutAdminSession();
          setAdminUser(null);
          setAdminProfile(null);
          setAuthError("This account is not registered as an admin.");
          return;
        }

        setAdminUser(user);
        setAdminProfile(profile);
        setAuthError("");
      } catch (error) {
        setAdminUser(null);
        setAdminProfile(null);
        setAuthError(parseAuthError(error));
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, [ensureProfileForUser, firebaseAuthReady]);

  const login = useCallback(async (email, password) => {
    setAuthWorking(true);
    setAuthError("");
    try {
      await signInAdminWithEmailPassword({ email, password });
      return { success: true, error: "" };
    } catch (error) {
      const message = parseAuthError(error);
      setAuthError(message);
      return { success: false, error: message };
    } finally {
      setAuthWorking(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthWorking(true);
    try {
      await signOutAdminSession();
      setAdminUser(null);
      setAdminProfile(null);
      setAuthError("");
    } finally {
      setAuthWorking(false);
    }
  }, []);

  const addRegularAdmin = useCallback(
    async ({ email, password, name }) => {
      if (!adminUser || !adminProfile) {
        throw new Error("You must be logged in as admin.");
      }
      if (adminProfile.role !== "super") {
        throw new Error("Only a super admin can add regular admin users.");
      }

      const created = await createRegularAdminAuthUser({
        email: String(email || "").trim(),
        password: String(password || ""),
        displayName: String(name || "").trim(),
      });

      const profile = await upsertAdminProfile(created.uid, {
        email: created.email,
        name: created.displayName || String(name || "").trim(),
        role: "regular",
        active: true,
        createdBy: adminUser.uid,
      });

      return { user: created, profile };
    },
    [adminProfile, adminUser],
  );

  return {
    firebaseAuthReady,
    adminUser,
    adminProfile,
    authLoading,
    authWorking,
    authError,
    isAdminAuthenticated: Boolean(adminUser && adminProfile),
    login,
    logout,
    addRegularAdmin,
  };
};

