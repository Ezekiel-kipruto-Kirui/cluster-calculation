import { getApp, getApps, initializeApp } from "firebase/app";
import { get, getDatabase, ref, set } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const courseCatalogPath = import.meta.env.VITE_REALTIME_COURSES_PATH || "courses";
const sessionsPath = import.meta.env.VITE_REALTIME_SESSIONS_PATH || "clusterSessions";
const adminsPath = import.meta.env.VITE_REALTIME_ADMINS_PATH || "admins";
const localSessionsStorageKey = "kuccps.cluster.sessions";

const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId);

export const isFirebaseReady = () => isFirebaseConfigured();

const getFirebaseApp = () => {
  if (getApps().length) return getApp();
  return initializeApp(firebaseConfig);
};

const requireFirebaseApp = () => {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured. Set the required VITE_FIREBASE_* variables.");
  }
  return getFirebaseApp();
};

const normalizeFirebaseError = (error, fallbackMessage) => {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  if (code.includes("PERMISSION_DENIED") || /permission[_\s-]?denied/i.test(message)) {
    return "Firebase permission denied. Update Realtime Database rules to allow this write/read path.";
  }
  return message || fallbackMessage;
};

const toRequirementsObject = (requirementsValue) => {
  if (!requirementsValue) return {};
  if (Array.isArray(requirementsValue)) {
    const objectRequirements = {};
    requirementsValue.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "string" && entry.includes(":")) {
        const [subject, grade] = entry.split(":");
        objectRequirements[String(subject).trim()] = String(grade).trim();
      } else if (entry.subject && entry.grade) {
        objectRequirements[String(entry.subject).trim()] = String(entry.grade).trim();
      }
    });
    return objectRequirements;
  }
  if (typeof requirementsValue === "object") return requirementsValue;
  return {};
};

const toUniversitiesArray = (universitiesValue) => {
  if (!universitiesValue) return [];
  const source = Array.isArray(universitiesValue)
    ? universitiesValue
    : Object.values(universitiesValue);
  return source
    .map((entry) => ({
      name: entry?.name || "",
      cutoff: Number(entry?.cutoff ?? 0),
      courseCode: entry?.courseCode || "",
    }))
    .filter((entry) => entry.name);
};

const normalizeCourse = (rawCourse, fallbackName = "") => ({
  name: rawCourse?.name || fallbackName,
  requirements: toRequirementsObject(rawCourse?.requirements),
  universities: toUniversitiesArray(rawCourse?.universities),
});

const normalizeClusterValue = (clusterValue) => {
  const items = Array.isArray(clusterValue) ? clusterValue : Object.values(clusterValue || {});
  return items
    .map((entry) => normalizeCourse(entry))
    .filter((course) => Boolean(course.name));
};

const normalizeCourseCatalog = (raw) => {
  if (!raw || typeof raw !== "object") return {};

  const normalized = {};
  const rawEntries = Object.entries(raw);
  const looksLikeClusterMap = rawEntries.every(([key, value]) => {
    const clusterNumber = Number(key);
    return Number.isInteger(clusterNumber) && clusterNumber >= 1 && typeof value === "object";
  });

  if (looksLikeClusterMap) {
    rawEntries.forEach(([clusterKey, clusterValue]) => {
      normalized[Number(clusterKey)] = normalizeClusterValue(clusterValue);
    });
    return normalized;
  }

  rawEntries.forEach(([courseKey, courseValue]) => {
    const cluster = Number(courseValue?.cluster);
    if (!Number.isInteger(cluster) || cluster < 1) return;
    if (!normalized[cluster]) normalized[cluster] = [];
    normalized[cluster].push(normalizeCourse(courseValue, courseKey));
  });

  return normalized;
};

export const fetchCourseCatalog = async () => {
  if (!isFirebaseConfigured()) return {};

  const app = getFirebaseApp();
  const db = getDatabase(app);
  const snapshot = await get(ref(db, courseCatalogPath));
  if (!snapshot.exists()) return {};
  return normalizeCourseCatalog(snapshot.val());
};

const accessCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const normalizeSessionCode = (code) => String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const generateAccessCode = (length = 8) => {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => accessCodeAlphabet[byte % accessCodeAlphabet.length]).join("");
  }

  let value = "";
  for (let index = 0; index < length; index += 1) {
    const random = Math.floor(Math.random() * accessCodeAlphabet.length);
    value += accessCodeAlphabet[random];
  }
  return value;
};

const createUniqueAccessCode = async (db) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateAccessCode();
    const snapshot = await get(ref(db, `${sessionsPath}/${code}`));
    if (!snapshot.exists()) return code;
  }
  throw new Error("Unable to generate a unique access code.");
};

const getLocalSessionsMap = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(localSessionsStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const setLocalSessionsMap = (sessionsMap) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localSessionsStorageKey, JSON.stringify(sessionsMap || {}));
};

const createUniqueLocalCode = () => {
  const existing = getLocalSessionsMap();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateAccessCode();
    if (!existing[code]) return code;
  }
  throw new Error("Unable to generate a local access code.");
};

const saveLocalSession = (sessionPayload) => {
  const sessionsMap = getLocalSessionsMap();
  sessionsMap[sessionPayload.code] = sessionPayload;
  setLocalSessionsMap(sessionsMap);
};

export const saveClusterSession = async ({
  email,
  phoneNumber,
  amountPaid,
  grades,
  results,
  medicineEligible,
  paymentResponse,
}) => {
  const app = requireFirebaseApp();
  const db = getDatabase(app);
  let code;
  try {
    code = await createUniqueAccessCode(db);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to create an access code in Firebase."));
  }
  const timestamp = new Date().toISOString();
  const payload = {
    code,
    email: String(email || "").trim(),
    phoneNumber: String(phoneNumber || "").trim(),
    amountPaid: Number(amountPaid ?? 0),
    grades: grades || {},
    results: results || {},
    medicineEligible: Boolean(medicineEligible),
    paymentResponse: paymentResponse || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    await set(ref(db, `${sessionsPath}/${code}`), payload);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to save session to Firebase."));
  }
  return payload;
};

export const saveClusterSessionWithFallback = async (payload) => {
  try {
    const session = await saveClusterSession(payload);
    return { session, storage: "firebase", warning: "" };
  } catch (error) {
    const timestamp = new Date().toISOString();
    const localCode = createUniqueLocalCode();
    const localSession = {
      code: localCode,
      email: String(payload?.email || "").trim(),
      phoneNumber: String(payload?.phoneNumber || "").trim(),
      amountPaid: Number(payload?.amountPaid ?? 0),
      grades: payload?.grades || {},
      results: payload?.results || {},
      medicineEligible: Boolean(payload?.medicineEligible),
      paymentResponse: payload?.paymentResponse || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      storage: "local",
    };

    saveLocalSession(localSession);
    return {
      session: localSession,
      storage: "local",
      warning: error?.message || "Firebase save failed. Session saved locally on this browser only.",
    };
  }
};

export const fetchClusterSessionByCode = async (code) => {
  const normalizedCode = normalizeSessionCode(code);
  if (!normalizedCode) return null;

  let firebaseError = null;
  try {
    const app = requireFirebaseApp();
    const db = getDatabase(app);
    const snapshot = await get(ref(db, `${sessionsPath}/${normalizedCode}`));
    if (snapshot.exists()) {
      const value = snapshot.val() || {};
      return {
        code: normalizedCode,
        email: value.email || "",
        phoneNumber: value.phoneNumber || "",
        amountPaid: Number(value.amountPaid ?? 0),
        grades: value.grades || {},
        results: value.results || {},
        medicineEligible: Boolean(value.medicineEligible),
        paymentResponse: value.paymentResponse || null,
        createdAt: value.createdAt || "",
        updatedAt: value.updatedAt || "",
        storage: "firebase",
      };
    }
  } catch (error) {
    firebaseError = error;
  }

  const local = getLocalSessionsMap()[normalizedCode];
  if (local) {
    return {
      code: normalizedCode,
      email: local.email || "",
      phoneNumber: local.phoneNumber || "",
      amountPaid: Number(local.amountPaid ?? 0),
      grades: local.grades || {},
      results: local.results || {},
      medicineEligible: Boolean(local.medicineEligible),
      paymentResponse: local.paymentResponse || null,
      createdAt: local.createdAt || "",
      updatedAt: local.updatedAt || "",
      storage: "local",
    };
  }

  if (firebaseError) {
    throw new Error(normalizeFirebaseError(firebaseError, "Unable to load session from Firebase."));
  }
  return null;
};

export const uploadCourseCatalog = async (catalog) => {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Invalid course catalog payload.");
  }

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  try {
    await set(ref(db, courseCatalogPath), catalog);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to upload course catalog to Firebase."));
  }
};

export const fetchAdminProfile = async (uid) => {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) return null;

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  try {
    const snapshot = await get(ref(db, `${adminsPath}/${normalizedUid}`));
    if (!snapshot.exists()) return null;
    const value = snapshot.val() || {};
    return {
      uid: normalizedUid,
      email: value.email || "",
      name: value.name || "",
      role: value.role || "regular",
      active: value.active !== false,
      createdAt: value.createdAt || "",
      updatedAt: value.updatedAt || "",
      createdBy: value.createdBy || "",
    };
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to load admin profile."));
  }
};

export const upsertAdminProfile = async (uid, patch) => {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) throw new Error("Admin uid is required.");

  const existing = await fetchAdminProfile(normalizedUid);
  const timestamp = new Date().toISOString();
  const payload = {
    uid: normalizedUid,
    email: String(patch?.email ?? existing?.email ?? "").trim(),
    name: String(patch?.name ?? existing?.name ?? "").trim(),
    role: String(patch?.role ?? existing?.role ?? "regular").trim() || "regular",
    active: patch?.active ?? existing?.active ?? true,
    createdBy: String(patch?.createdBy ?? existing?.createdBy ?? "").trim(),
    createdAt: existing?.createdAt || patch?.createdAt || timestamp,
    updatedAt: timestamp,
  };

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  try {
    await set(ref(db, `${adminsPath}/${normalizedUid}`), payload);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to save admin profile."));
  }

  return payload;
};
