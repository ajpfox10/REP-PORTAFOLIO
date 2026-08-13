import React, { useState } from 'react';
import { Layout } from '../../components/Layout';
import { AptosTab } from './AptosTab';
import { TramitesTab } from './TramitesTab';
import { OrdenDocsTab } from './OrdenDocsTab';
import './styles/TramitesDocumentalesPage.css';

// Pestana "Tramites" reescrita de raiz (2026-08): flujo de tandas de interinos 10430
// + explorador de la carpeta DOCU del agente. El flujo viejo (analisis de PDFs de
// Descargas, combinado, providencia, etc.) fue retirado; sus endpoints quedaron
// marcados como SIN USO en el backend. La pestana "Aptos" se mantiene intacta.

export function TramitesDocumentalesPage() {
  const [pageTab, setPageTab] = useState<'tramites' | 'aptos' | 'orden'>('tramites');

  return (
    <Layout title="Trámites documentales" showBack>
      {/* Pestañas de la página */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {([['tramites', '📄 Trámites'], ['aptos', '🩺 Aptos'], ['orden', '📋 Orden de documentos']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setPageTab(key)}
            style={{
              padding: '7px 18px', fontSize: '0.8rem', fontWeight: pageTab === key ? 700 : 400,
              background: 'none', border: 'none', cursor: 'pointer',
              color: pageTab === key ? '#fff' : '#64748b',
              borderBottom: pageTab === key ? '2px solid #7c3aed' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {label}
          </button>
        ))}
      </div>

      {pageTab === 'aptos' ? <AptosTab /> : pageTab === 'orden' ? <OrdenDocsTab /> : <TramitesTab />}
    </Layout>
  );
}
