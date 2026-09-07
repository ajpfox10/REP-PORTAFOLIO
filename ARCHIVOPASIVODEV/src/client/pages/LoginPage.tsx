import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/http";
import { useAuth } from "../auth/AuthProvider";

type AuthMode = "login" | "request" | "confirm" | "forgot" | "reset";

type ApiMessage = {
  ok: boolean;
  message?: string;
  data?: {
    confirmationCode?: string;
    resetUrl?: string;
  };
};

// Pantalla de ingreso y flujos publicos de acceso.
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialResetToken = searchParams.get("resetToken") ?? "";
  const [mode, setMode] = useState<AuthMode>(initialResetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [motivo, setMotivo] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [devValue, setDevValue] = useState("");

  // Cambia el flujo visible y limpia mensajes transitorios.
  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setDevValue("");
  }

  // Inicia sesion con credenciales locales y codigo 2FA si aplica.
  async function submitLogin() {
    await login(email, password, twoFactorCode || undefined);
    navigate("/", { replace: true });
  }

  // Registra una solicitud publica para revision administrativa.
  async function submitRequest() {
    const res = await apiFetch<ApiMessage>("/auth/request-access", {
      method: "POST",
      body: JSON.stringify({ nombre, email, motivo }),
    });
    setMessage(res.message || "Solicitud registrada.");
    setDevValue(res.data?.confirmationCode ? `Codigo de confirmacion: ${res.data.confirmationCode}` : "");
    setMode("confirm");
  }

  // Confirma el email informado en una solicitud.
  async function submitConfirm() {
    const res = await apiFetch<ApiMessage>("/auth/confirm-access", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    setMessage(res.message || "Solicitud confirmada.");
  }

  // Solicita un token de recuperacion de contrasena.
  async function submitForgot() {
    const res = await apiFetch<ApiMessage>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setMessage(res.message || "Solicitud procesada.");
    setDevValue(res.data?.resetUrl ? `Link de desarrollo: ${res.data.resetUrl}` : "");
  }

  // Cambia la contrasena con un token vigente.
  async function submitReset() {
    const res = await apiFetch<ApiMessage>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: resetToken, password }),
    });
    setMessage(res.message || "Contrasena actualizada.");
    setPassword("");
    setMode("login");
  }

  // Despacha el submit al flujo activo.
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      if (mode === "login") await submitLogin();
      if (mode === "request") await submitRequest();
      if (mode === "confirm") await submitConfirm();
      if (mode === "forgot") await submitForgot();
      if (mode === "reset") await submitReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la operacion");
    }
  }

  const title = {
    login: "Ingresar al sistema",
    request: "Solicitar usuario",
    confirm: "Confirmar solicitud",
    forgot: "Recuperar acceso",
    reset: "Nueva contrasena",
  }[mode];

  const subtitle = {
    login: "Acceso administrativo con JWT, permisos finos y sesiones revocables.",
    request: "Complete los datos para que administracion revise el alta.",
    confirm: "Ingrese el codigo recibido para validar el email informado.",
    forgot: "Si el email existe, se generara una instruccion de reseteo.",
    reset: "Defina una contrasena nueva de al menos 10 caracteres.",
  }[mode];

  const actionText = {
    login: "Ingresar",
    request: "Enviar solicitud",
    confirm: "Confirmar email",
    forgot: "Generar reseteo",
    reset: "Cambiar contrasena",
  }[mode];

  const showEmail = mode !== "reset";
  const showPassword = mode === "login" || mode === "reset";

  return (
    <main className="auth-screen">
      <section className="auth-brand" aria-label="Presentacion">
        <div className="brand-mark">Archivo Pasivo</div>
        <div>
          <h1>Gestion documental del Archivo Pasivo</h1>
          <p>Login seguro, permisos por modulo, auditoria y recuperacion de cuenta preparados para administracion interna.</p>
        </div>
      </section>

      <section className="auth-workspace">
        <form className="auth-card" onSubmit={submit}>
          <div className="mode-tabs" aria-label="Opciones de acceso">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Ingresar</button>
            <button type="button" className={mode === "request" ? "active" : ""} onClick={() => changeMode("request")}>Solicitar</button>
            <button type="button" className={mode === "forgot" ? "active" : ""} onClick={() => changeMode("forgot")}>Recuperar</button>
            <button type="button" className={mode === "confirm" ? "active" : ""} onClick={() => changeMode("confirm")}>Confirmar</button>
          </div>

          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>

          <div className="auth-form">
            {mode === "request" && (
              <label className="field">
                Nombre completo
                <input value={nombre} onChange={(event) => setNombre(event.target.value)} autoComplete="name" />
              </label>
            )}

            {showEmail && (
              <label className="field">
                Usuario o email
                <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
              </label>
            )}

            {mode === "request" && (
              <label className="field">
                Motivo
                <textarea value={motivo} onChange={(event) => setMotivo(event.target.value)} />
              </label>
            )}

            {mode === "confirm" && (
              <label className="field">
                Codigo de confirmacion
                <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" />
              </label>
            )}

            {mode === "reset" && (
              <label className="field">
                Token de reseteo
                <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} />
              </label>
            )}

            {showPassword && (
              <label className="field">
                {mode === "reset" ? "Nueva contrasena" : "Contrasena"}
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "reset" ? "new-password" : "current-password"}
                />
              </label>
            )}

            {mode === "login" && (
              <label className="field">
                Codigo 2FA
                <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} inputMode="numeric" />
              </label>
            )}

            {error && <p className="notice error">{error}</p>}
            {message && <p className="notice success">{message}</p>}
            {devValue && <p className="notice success dev-token">{devValue}</p>}

            <div className="auth-actions">
              <button className="primary-action" type="submit">{actionText}</button>
              {mode !== "reset" && (
                <button className="secondary-action" type="button" onClick={() => changeMode("reset")}>
                  Tengo token
                </button>
              )}
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
