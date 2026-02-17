import { useState } from "react";
import bundledCoursesCsvUrl from "../courses.csv?url";
import AlertMessage from "../components/common/AlertMessage";
import CsvUploadPanel from "../components/admin/CsvUploadPanel";

const emptyAdminForm = { name: "", email: "", password: "" };

export default function AdminPage({
  firebaseConfigured,
  onUploadCatalog,
  onLogout,
  onAddRegularAdmin,
  adminProfile,
  adminEmail,
  authError,
}) {
  const [form, setForm] = useState(emptyAdminForm);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const canManageAdmins = adminProfile?.role === "super";

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submitRegularAdmin = async (event) => {
    event.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!canManageAdmins) {
      setFormError("Only a super admin can add regular admins.");
      return;
    }

    if (!form.email || !form.password) {
      setFormError("Email and password are required.");
      return;
    }

    setFormLoading(true);
    try {
      const response = await onAddRegularAdmin({
        name: form.name,
        email: form.email,
        password: form.password,
      });
      setFormSuccess(`Regular admin added: ${response.user.email}`);
      setForm(emptyAdminForm);
    } catch (error) {
      setFormError(error.message || "Unable to add regular admin.");
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Upload and manage course and university data.</p>
            <p className="mt-2 text-xs font-medium text-slate-500">
              Signed in as: {adminEmail || "unknown"} ({adminProfile?.role || "regular"} admin)
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Logout
          </button>
        </div>
        <AlertMessage className="mt-3" tone="danger" message={authError} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">Admin Users</h2>
        <p className="mt-1 text-sm text-slate-600">
          Create regular admin accounts that can log in and access admin tools.
        </p>
        {!canManageAdmins ? (
          <AlertMessage
            className="mt-3"
            tone="warning"
            message="Only a super admin can add regular admin users."
          />
        ) : null}

        <form onSubmit={submitRegularAdmin} className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="regular_admin_name" className="mb-1 block text-sm font-medium text-slate-700">
              Full Name
            </label>
            <input
              id="regular_admin_name"
              type="text"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              className="block w-full rounded-lg border-slate-300 text-slate-900 shadow-sm focus:border-slate-500 focus:ring-slate-500"
              placeholder="Admin Name"
            />
          </div>
          <div>
            <label htmlFor="regular_admin_email" className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="regular_admin_email"
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              required
              className="block w-full rounded-lg border-slate-300 text-slate-900 shadow-sm focus:border-slate-500 focus:ring-slate-500"
              placeholder="newadmin@example.com"
            />
          </div>
          <div>
            <label htmlFor="regular_admin_password" className="mb-1 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="regular_admin_password"
              type="password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              required
              minLength={6}
              className="block w-full rounded-lg border-slate-300 text-slate-900 shadow-sm focus:border-slate-500 focus:ring-slate-500"
              placeholder="At least 6 characters"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={!canManageAdmins || formLoading}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {formLoading ? "Creating..." : "Add Regular Admin"}
            </button>
          </div>
        </form>
        <AlertMessage className="mt-3" tone="danger" message={formError} />
        <AlertMessage className="mt-3" tone="success" message={formSuccess} />
      </div>

      <CsvUploadPanel
        firebaseConfigured={firebaseConfigured}
        onUploadCatalog={onUploadCatalog}
        bundledCoursesCsvUrl={bundledCoursesCsvUrl}
      />
    </section>
  );
}
