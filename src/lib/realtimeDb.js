import { getApp, getApps, initializeApp } from "firebase/app";
import { get, getDatabase, ref, remove, set, update } from "firebase/database";

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

const normalizeRequirementsMap = (requirements) => {
  const normalized = {};
  Object.entries(toRequirementsObject(requirements)).forEach(([subject, grade]) => {
    const normalizedSubject = String(subject || "").trim();
    const normalizedGrade = String(grade || "").trim().toUpperCase();
    if (!normalizedSubject || !normalizedGrade) return;
    normalized[normalizedSubject] = normalizedGrade;
  });
  return normalized;
};

const normalizeUniversityEntry = (entry) => {
  const name = String(entry?.name || "").trim();
  if (!name) return null;
  const courseCode = String(entry?.courseCode || "").trim();
  const cutoffValue = Number(entry?.cutoff ?? 0);
  return {
    name,
    courseCode,
    cutoff: Number.isFinite(cutoffValue) ? cutoffValue : 0,
  };
};

const universityKey = (entry) =>
  `${String(entry?.name || "").trim().toLowerCase()}|${String(entry?.courseCode || "").trim().toLowerCase()}`;

const mergeUniversityEntries = (existingUniversities = [], nextUniversities = []) => {
  const map = new Map();
  [...existingUniversities, ...nextUniversities].forEach((entry) => {
    const normalized = normalizeUniversityEntry(entry);
    if (!normalized) return;
    map.set(universityKey(normalized), normalized);
  });
  return Array.from(map.values());
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

const normalizeSessionResults = (value) => {
  const raw = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (let cluster = 1; cluster <= 20; cluster += 1) {
    const score = Number(raw[cluster] ?? raw[String(cluster)] ?? 0);
    normalized[cluster] = Number.isFinite(score) ? score : 0;
  }
  return normalized;
};

const normalizeSessionGrades = (value) => {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  Object.entries(value).forEach(([subject, grade]) => {
    const subjectCode = String(subject || "").trim().toUpperCase();
    const normalizedGrade = String(grade || "").trim().toUpperCase();
    if (!subjectCode || !normalizedGrade) return;
    normalized[subjectCode] = normalizedGrade;
  });
  return normalized;
};

export const fetchAllClusterSessions = async () => {
  const app = requireFirebaseApp();
  const db = getDatabase(app);

  try {
    const snapshot = await get(ref(db, sessionsPath));
    if (!snapshot.exists()) return [];

    return Object.entries(snapshot.val() || {})
      .map(([code, value]) => {
        const sessionCode = normalizeSessionCode(code);
        const payload = value && typeof value === "object" ? value : {};
        const createdAt = String(payload.createdAt || "");

        return {
          code: sessionCode,
          email: String(payload.email || "").trim(),
          phoneNumber: String(payload.phoneNumber || "").trim(),
          amountPaid: Number(payload.amountPaid ?? 0),
          createdAt,
          updatedAt: String(payload.updatedAt || ""),
          medicineEligible: Boolean(payload.medicineEligible),
          grades: normalizeSessionGrades(payload.grades),
          results: normalizeSessionResults(payload.results),
          paymentResponse: payload.paymentResponse || null,
          storage: "firebase",
        };
      })
      .filter((session) => session.code)
      .sort((a, b) => {
        const first = Date.parse(a.createdAt || "") || 0;
        const second = Date.parse(b.createdAt || "") || 0;
        return second - first;
      });
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to load calculated sessions from Firebase."));
  }
};

export const updateClusterSessionByCode = async (code, patch = {}) => {
  const normalizedCode = normalizeSessionCode(code);
  if (!normalizedCode) {
    throw new Error("Session code is required.");
  }
  if (!patch || typeof patch !== "object") {
    throw new Error("Invalid session patch payload.");
  }

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  const sessionRef = ref(db, `${sessionsPath}/${normalizedCode}`);

  let snapshot;
  try {
    snapshot = await get(sessionRef);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to load session before update."));
  }
  if (!snapshot.exists()) {
    throw new Error("Session not found.");
  }

  const payload = {};
  if ("email" in patch) payload.email = String(patch.email || "").trim();
  if ("phoneNumber" in patch) payload.phoneNumber = String(patch.phoneNumber || "").trim();
  if ("medicineEligible" in patch) payload.medicineEligible = Boolean(patch.medicineEligible);
  if ("grades" in patch) payload.grades = normalizeSessionGrades(patch.grades);
  if ("results" in patch) payload.results = normalizeSessionResults(patch.results);
  if ("paymentResponse" in patch) payload.paymentResponse = patch.paymentResponse ?? null;
  if ("amountPaid" in patch) {
    const amount = Number(patch.amountPaid ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Amount paid must be a valid number equal to or greater than 0.");
    }
    payload.amountPaid = amount;
  }
  payload.updatedAt = new Date().toISOString();

  try {
    await update(sessionRef, payload);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to update session."));
  }
};

export const deleteClusterSessionByCode = async (code) => {
  const normalizedCode = normalizeSessionCode(code);
  if (!normalizedCode) {
    throw new Error("Session code is required.");
  }

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  try {
    await remove(ref(db, `${sessionsPath}/${normalizedCode}`));
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to delete session."));
  }
};

export const deleteClusterSessionsByCodes = async (codes = []) => {
  const normalizedCodes = Array.from(
    new Set(
      (Array.isArray(codes) ? codes : [])
        .map((code) => normalizeSessionCode(code))
        .filter(Boolean),
    ),
  );

  if (!normalizedCodes.length) return 0;

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  const payload = {};
  normalizedCodes.forEach((code) => {
    payload[`${sessionsPath}/${code}`] = null;
  });

  try {
    await update(ref(db), payload);
    return normalizedCodes.length;
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to delete selected sessions."));
  }
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

export const upsertSingleCourseCatalogEntry = async ({ cluster, name, requirements, universities }) => {
  const normalizedCluster = Number(cluster);
  if (!Number.isInteger(normalizedCluster) || normalizedCluster < 1) {
    throw new Error("Cluster must be a positive whole number.");
  }

  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("Course name is required.");
  }

  const normalizedRequirements = normalizeRequirementsMap(requirements);
  const normalizedUniversities = toUniversitiesArray(universities)
    .map((entry) => normalizeUniversityEntry(entry))
    .filter(Boolean);

  if (!normalizedUniversities.length) {
    throw new Error("At least one university entry is required.");
  }

  const catalog = await fetchCourseCatalog();
  const clusterCourses = Array.isArray(catalog[normalizedCluster]) ? [...catalog[normalizedCluster]] : [];
  const existingIndex = clusterCourses.findIndex(
    (course) => String(course?.name || "").trim().toLowerCase() === normalizedName.toLowerCase(),
  );

  const mergedCourse =
    existingIndex >= 0
      ? {
          name: normalizedName,
          requirements: {
            ...normalizeRequirementsMap(clusterCourses[existingIndex]?.requirements),
            ...normalizedRequirements,
          },
          universities: mergeUniversityEntries(clusterCourses[existingIndex]?.universities, normalizedUniversities),
        }
      : {
          name: normalizedName,
          requirements: normalizedRequirements,
          universities: normalizedUniversities,
        };

  if (existingIndex >= 0) clusterCourses[existingIndex] = mergedCourse;
  else clusterCourses.push(mergedCourse);

  catalog[normalizedCluster] = clusterCourses;

  const app = requireFirebaseApp();
  const db = getDatabase(app);
  try {
    await set(ref(db, courseCatalogPath), catalog);
  } catch (error) {
    throw new Error(normalizeFirebaseError(error, "Unable to save course entry to Firebase."));
  }

  return mergedCourse;
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
