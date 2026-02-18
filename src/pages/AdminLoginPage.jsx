import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AlertMessage from "../components/common/AlertMessage";

export default function AdminLoginPage({ isAuthenticated, onLogin, authError, isLoading }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (isAuthenticated) return <Navigate to="/admin" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const response = await onLogin(email, password);
    if (response.success) {
      navigate("/admin");
      return;
    }
    setError(response.error || "Invalid admin credentials.");
  };

  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Admin Login</h1>
      <p className="mt-2 text-sm text-slate-600">Only admins can upload course data to Firebase.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="admin_email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="admin_email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="ui-input"
            placeholder="admin@example.com"
          />
        </div>
        <div>
          <label htmlFor="admin_password" className="mb-1 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="admin_password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className="ui-input"
          />
        </div>

        <AlertMessage tone="danger" message={error} />
        <AlertMessage tone="danger" message={authError} />

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:from-slate-800 hover:to-slate-700"
        >
          {isLoading ? "Signing in..." : "Login"}
        </button>
      </form>
    </section>
  );
}
