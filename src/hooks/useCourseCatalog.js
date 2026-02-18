import { useCallback, useEffect, useState } from "react";
import { fetchCourseCatalog, uploadCourseCatalog, upsertSingleCourseCatalogEntry } from "../lib/realtimeDb";

export const useCourseCatalog = () => {
  const [courseCatalog, setCourseCatalog] = useState({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [courseCatalogError, setCourseCatalogError] = useState("");

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const catalog = await fetchCourseCatalog();
      setCourseCatalog(catalog);
      setCourseCatalogError("");
    } catch (error) {
      setCourseCatalog({});
      setCourseCatalogError(error.message || "Unable to load courses from realtime database.");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const saveCatalog = useCallback(
    async (catalog) => {
      await uploadCourseCatalog(catalog);
      setCourseCatalogError("");
      await loadCatalog();
    },
    [loadCatalog],
  );

  const saveSingleCourse = useCallback(
    async (coursePayload) => {
      await upsertSingleCourseCatalogEntry(coursePayload);
      setCourseCatalogError("");
      await loadCatalog();
    },
    [loadCatalog],
  );

  useEffect(() => {
    loadCatalog().catch(() => {
      // loadCatalog updates user-facing error state.
    });
  }, [loadCatalog]);

  return {
    courseCatalog,
    catalogLoading,
    courseCatalogError,
    loadCatalog,
    saveCatalog,
    saveSingleCourse,
  };
};
