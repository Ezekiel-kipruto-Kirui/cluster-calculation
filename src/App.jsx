import { useCallback, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import AlertMessage from "./components/common/AlertMessage";
import { GRADE_OPTIONS, PAYABLE_AMOUNT } from "./config/appConfig";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { SUBJECTS } from "./lib/clusterEngine";
import { fetchClusterSessionByCode, isFirebaseReady } from "./lib/realtimeDb";
import { useCourseCatalog } from "./hooks/useCourseCatalog";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminPage from "./pages/AdminPage";
import AdminSessionsPage from "./pages/AdminSessionsPage";
import CalculatorPage from "./pages/CalculatorPage";
import CourseResultPage from "./pages/CourseResultPage";
import LandingPage from "./pages/LandingPage";
import PaymentPage from "./pages/PaymentPage";
import ResultsPage from "./pages/ResultsPage";

const emptyGrades = () => Object.fromEntries(Object.keys(SUBJECTS).map((code) => [code, ""]));

export default function App() {
  const [pendingGrades, setPendingGrades] = useState(null);
  const [finalGrades, setFinalGrades] = useState(null);
  const [results, setResults] = useState(null);
  const [calcSource, setCalcSource] = useState("local-engine");
  const [accessCode, setAccessCode] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");

  const firebaseConfigured = useMemo(() => isFirebaseReady(), []);

  const { courseCatalog, catalogLoading, courseCatalogError, saveCatalog, saveSingleCourse } = useCourseCatalog();
  const {
    adminUser,
    adminProfile,
    authLoading,
    authWorking,
    authError,
    isAdminAuthenticated,
    login,
    logout,
    addRegularAdmin,
  } = useAdminAuth();

  const restoreByCode = useCallback(async (code) => {
    const session = await fetchClusterSessionByCode(code);
    if (!session || !session.results) return null;

    setPendingGrades(null);
    setFinalGrades(session.grades || emptyGrades());
    setResults(session.results || null);
    setCalcSource("saved-session");
    setAccessCode(session.code);
    setSessionMessage(
      session.createdAt
        ? `Loaded ${session.storage === "local" ? "local" : "saved"} session from ${new Date(session.createdAt).toLocaleString()}.`
        : `Loaded ${session.storage === "local" ? "local" : "saved"} session.`,
    );

    return session;
  }, []);

  const handleCatalogUpload = useCallback(
    async (catalog) => {
      await saveCatalog(catalog);
    },
    [saveCatalog],
  );

  const handleSingleCourseSave = useCallback(
    async (coursePayload) => {
      await saveSingleCourse(coursePayload);
    },
    [saveSingleCourse],
  );

  const handleAdminLogin = useCallback(
    async (email, password) => {
      const response = await login(email, password);
      return response;
    },
    [login],
  );

  const handleAdminLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const renderAdminProtected = useCallback(
    (element) => {
      if (authLoading) {
        return (
          <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <AlertMessage tone="info" message="Checking admin authentication..." />
          </section>
        );
      }
      if (!isAdminAuthenticated) return <Navigate to="/admin/login" replace />;
      return element;
    },
    [authLoading, isAdminAuthenticated],
  );

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<LandingPage onRestoreByCode={restoreByCode} payableAmount={PAYABLE_AMOUNT} />} />
        <Route
          path="/admin/login"
          element={
            <AdminLoginPage
              isAuthenticated={isAdminAuthenticated}
              onLogin={handleAdminLogin}
              authError={authError}
              isLoading={authWorking || authLoading}
            />
          }
        />
        <Route
          path="/admin"
          element={renderAdminProtected(
            <AdminPage
              firebaseConfigured={firebaseConfigured}
              onUploadCatalog={handleCatalogUpload}
              onAddSingleCourse={handleSingleCourseSave}
              onLogout={handleAdminLogout}
              onAddRegularAdmin={addRegularAdmin}
              adminProfile={adminProfile}
              adminEmail={adminUser?.email || ""}
              authError={authError}
              courseCatalog={courseCatalog}
            />,
          )}
        />
        <Route
          path="/admin/sessions"
          element={renderAdminProtected(<AdminSessionsPage firebaseConfigured={firebaseConfigured} />)}
        />
        <Route
          path="/calculator"
          element={<CalculatorPage gradeOptions={GRADE_OPTIONS} onContinue={(grades) => setPendingGrades(grades)} />}
        />
        <Route
          path="/payment"
          element={
            <PaymentPage
              pendingGrades={pendingGrades}
              payableAmount={PAYABLE_AMOUNT}
              onCalculationReady={({ results: nextResults, source, accessCode: nextCode, sessionMessage: nextMessage }) => {
                setFinalGrades(pendingGrades);
                setResults(nextResults);
                setCalcSource(source);
                setAccessCode(nextCode || "");
                setSessionMessage(nextMessage || "");
                setPendingGrades(null);
              }}
            />
          }
        />
        <Route
          path="/results"
          element={
            <ResultsPage
              results={results}
              grades={finalGrades}
              source={calcSource}
              courseCatalog={courseCatalog}
              courseCatalogError={courseCatalogError}
              catalogLoading={catalogLoading}
              accessCode={accessCode}
              sessionMessage={sessionMessage}
            />
          }
        />
        <Route
          path="/course-result"
          element={<CourseResultPage results={results} grades={finalGrades} courseCatalog={courseCatalog} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
