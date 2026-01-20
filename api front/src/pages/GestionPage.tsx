import React, { useEffect, useRef, useState } from "react";
import { Layout } from "../components/Layout";
import { useToast } from "../ui/toast";
import { apiFetch, apiFetchBlob } from "../api/http";

export function GestionPage() {
  const toast = useToast();

  const [dni, setDni] = useState("");
  const [fullName, setFullName] = useState("");
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [row, setRow] = useState<any>(null);

  // ✅ Foto privada (blob url)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);

  function revokeLastObjectUrl() {
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current);
      lastObjectUrlRef.current = null;
    }
  }

  async function fetchFotoPrivada(dniValue: string) {
    revokeLastObjectUrl();
    setFotoUrl(null);

    const blob = await apiFetchBlob(`/agentes/${dniValue}/foto`);
    const objUrl = URL.createObjectURL(blob);
    lastObjectUrlRef.current = objUrl;
    setFotoUrl(objUrl);
  }

  // ✅ Cuando cambia el agente, levantamos la foto (privada)
  useEffect(() => {
    const d = row?.dni ? String(row.dni).replace(/\D/g, "") : "";
    if (!d) {
      revokeLastObjectUrl();
      setFotoUrl(null);
      return;
    }

    fetchFotoPrivada(d).catch((err) => {
      console.log("❌ Error cargando foto:", err?.message || err);
      setFotoUrl(null);
    });

    return () => {
      revokeLastObjectUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.dni]);

  async function onSearch() {
    const clean = dni.replace(/\D/g, "");
    if (!clean) {
      toast.error("DNI inválido", "Ingresá un DNI válido");
      return;
    }

    try {
      setLoading(true);
      setRow(null);
      setMatches([]);
      revokeLastObjectUrl();
      setFotoUrl(null);

      const res = await apiFetch<any>(`/agentes/${clean}`);
      setRow(res.data);
      toast.ok("Agente cargado");
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  async function onSearchByName() {
    const q = fullName.trim();
    if (!q) {
      toast.error("Búsqueda inválida", "Ingresá apellido y/o nombre");
      return;
    }

    try {
      setLoading(true);
      setMatches([]);
      setRow(null);
      revokeLastObjectUrl();
      setFotoUrl(null);

      const res = await apiFetch<any>(
        `/agentes?q=${encodeURIComponent(q)}&limit=20&page=1`
      );
      setMatches(res.data || []);
      toast.ok("Búsqueda lista");
    } catch (e: any) {
      toast.error("No se pudo buscar", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  async function loadByDni(d: string) {
    const clean = String(d).replace(/\D/g, "");
    setDni(clean);

    try {
      setLoading(true);
      setRow(null);
      setMatches([]);
      revokeLastObjectUrl();
      setFotoUrl(null);

      const res = await apiFetch<any>(`/agentes/${clean}`);
      setRow(res.data);
      toast.ok("Agente cargado");
    } catch (e: any) {
      toast.error("No se pudo cargar el agente", e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout title="Gestión" showBack>
      <div className="gestion-layout">
        {/* IZQUIERDA */}
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="search-row">
              <div className="search-field">
                <label className="label">DNI</label>
                <input
                  className="input"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearch()}
                  placeholder="Enter"
                />
              </div>

              <div className="search-field">
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearchByName()}
                  placeholder="Apellido Nombre (Enter)"
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }} className="muted">
              Buscá por DNI o por Apellido/Nombre. Enter y a otra cosa 😎
            </div>
          </div>

          {loading && (
            <div className="card" style={{ padding: 14 }}>
              Cargando…
            </div>
          )}

          {row && (
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>
                {row.apellido}, {row.nombre}
              </h3>

              <p><b>DNI:</b> {row.dni}</p>
              <p><b>CUIL:</b> {row.cuil || "-"}</p>
              <p><b>Ley:</b> {row.ley_nombre || row.ley_id}</p>
              <p><b>Dependencia:</b> {row.dependencia_nombre || "-"}</p>
              <p><b>Servicio:</b> {row.servicio_nombre || "-"}</p>
              <p><b>Desde:</b> {row.fecha_desde || "-"}</p>
              <p><b>Hasta:</b> {row.fecha_hasta ?? "Actual"}</p>
            </div>
          )}

          {!!matches.length && (
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ marginTop: 0 }}>Coincidencias</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {matches.map((m: any) => (
                  <li key={m.dni} style={{ margin: "8px 0" }}>
                    <button className="btn" onClick={() => loadByDni(m.dni)}>
                      {m.apellido}, {m.nombre} (DNI {m.dni})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* DERECHA */}
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>Foto credencial</h3>

            {!row?.dni ? (
              <p className="muted">Buscá un agente.</p>
            ) : fotoUrl ? (
              <img
                src={fotoUrl}
                alt="Foto credencial"
                style={{ width: "100%", borderRadius: 12, display: "block" }}
              />
            ) : (
              <p className="muted">Sin foto (o no autorizado).</p>
            )}
          </div>

          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>Panel derecho</h3>
            <p className="muted">Acá va historial, documentos, acciones, etc.</p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
