import React, { useState } from 'react';
import { Layout } from '../../components/Layout';
import { apiFetch } from '../../api/http';
import { useToast } from '../../ui/toast';

export function CargaSiapePage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const handleCargar = async () => {
    setLoading(true);
    setLastMessage(null);
    try {
      const r = await apiFetch<{ ok: boolean; msg?: string; error?: string }>('/intranet/cargar-francos-siape', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (r?.ok) {
        const msg = r.msg ?? 'Carga de compensatorios en SiAPe iniciada';
        setLastMessage(msg);
        toast.ok(msg);
      } else {
        const msg = r?.error ?? 'No se pudo iniciar la carga en SiAPe';
        setLastMessage(msg);
        toast.error(msg);
      }
    } catch (e: any) {
      const msg = e?.message ?? 'No se pudo iniciar la carga en SiAPe';
      setLastMessage(msg);
      toast.error('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Carga SiAPe" showBack>
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="h2" style={{ marginBottom: 8 }}>Carga de compensatorios</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Inicia la carga en SiAPe de los reconocimientos médicos pendientes.
        </p>
        <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button
            className="btn ok"
            type="button"
            disabled={loading}
            onClick={handleCargar}
            title="Abre SiAPe y carga los pendientes por el flujo de compensatorios"
          >
            {loading ? 'Abriendo SiAPe...' : 'Cargar en SiAPe'}
          </button>
          {lastMessage && <span className="muted">{lastMessage}</span>}
        </div>
      </div>
    </Layout>
  );
}
