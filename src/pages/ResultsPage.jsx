import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AlertMessage from "../components/common/AlertMessage";
import ClusterResultsTable from "../components/results/ClusterResultsTable";
import { getSourceLabel } from "../utils/messages";

export default function ResultsPage({
  results,
  grades,
  source,
  courseCatalog,
  courseCatalogError,
  catalogLoading,
  accessCode,
  sessionMessage,
}) {
  const navigate = useNavigate();
  const [selectedCourses, setSelectedCourses] = useState({});

  if (!results || !grades) return <Navigate to="/" replace />;

  const clusters = Array.from({ length: 20 }, (_, index) => index + 1);
  const getScore = (cluster) => Number(results[cluster] ?? results[String(cluster)] ?? 0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">All Cluster Points</h1>
      <p className="mt-2 text-sm text-slate-600">Select a course to evaluate your qualification details.</p>
      <p className="mt-1 text-xs font-medium text-slate-500">Calculation source: {getSourceLabel(source)}</p>

      {accessCode ? (
        <AlertMessage className="mt-3" tone="success" message={`Access code: ${accessCode}`} />
      ) : null}

      <AlertMessage className="mt-2" tone="info" message={sessionMessage} />
      {catalogLoading ? <AlertMessage className="mt-2" tone="info" message="Loading courses from realtime database..." /> : null}
      <AlertMessage className="mt-2" tone="danger" message={courseCatalogError} />

      <ClusterResultsTable
        clusters={clusters}
        getScore={getScore}
        courseCatalog={courseCatalog}
        selectedCourses={selectedCourses}
        onSelectCourse={(cluster, courseName) =>
          setSelectedCourses((current) => ({ ...current, [cluster]: courseName }))
        }
        onCheckCourse={(cluster, courseName) =>
          navigate(`/course-result?cluster=${cluster}&course=${encodeURIComponent(courseName)}`)
        }
      />
    </section>
  );
}

