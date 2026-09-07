import { FormEvent, useState } from "react";
import { apiFetch } from "../api/http";
import { clearSession } from "../auth/session";
import { useAuth } from "../auth/AuthProvider";

// Permite al usuario cambiar su contrasena propia.
export function AccountPage() {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const res = await apiFetch<{ ok: true; message?: string }>("/account/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setMessage(res.message || "Contrasena actualizada.");
      setCurrentPassword("");
      setNewPassword("");
      clearSession();
      setTimeout(() => logout(), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la contrasena");
    }
  }

  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <h1>Mi cuenta</h1>
          <p>Cambio de contrasena propia. Al confirmar, se invalidan las sesiones activas.</p>
        </div>
      </div>

      <form className="panel account-panel" onSubmit={submit}>
        <div className="panel-head">
          <h2>Seguridad</h2>
          <span>Reset personal</span>
        </div>
        {error && <div className="app-alert error">{error}</div>}
        {message && <div className="app-alert success">{message}</div>}
        <label className="form-field">Contrasena actual
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="form-field">Nueva contrasena
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <button className="primary-btn" type="submit">Actualizar contrasena</button>
      </form>
    </section>
  );
}
