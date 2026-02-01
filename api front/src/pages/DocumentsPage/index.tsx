// src/pages/DocumentsPage/index.tsx
import React, { useEffect } from 'react';
import { Layout } from '../../components/Layout';
import { useToast } from '../../ui/toast';

// Hooks
import { useDocumentSearch } from './hooks/useDocumentSearch';
import { useDocumentViewer } from './hooks/useDocumentViewer';

// Componentes
import { DocumentSearchBar } from './components/DocumentSearchBar';
import { DocumentList } from './components/DocumentList';
import { DocumentViewer } from './components/DocumentViewer';

// CSS (igual)
import './styles/DocumentsPage.css';

export function DocumentsPage() {
  const toast = useToast();
  
  // Hooks
  const documentSearch = useDocumentSearch();
  const documentViewer = useDocumentViewer(documentSearch.selected);

  // Carga inicial
  useEffect(() => {
    documentSearch.load().catch((e: any) => {
      toast.error('No se pudo cargar documentos', e?.message || 'Error');
    });
  }, []);

  // Función de búsqueda con error handling
  const handleSearch = async () => {
    try {
      await documentSearch.load();
    } catch (e: any) {
      toast.error('No se pudo cargar documentos', e?.message || 'Error');
    }
  };

  return (
    <Layout title="Documentos" showBack>
      {/* Barra de búsqueda */}
      <DocumentSearchBar
        q={documentSearch.q}
        loading={documentSearch.loading}
        totalResults={documentSearch.totalResults}
        onSearchChange={(e) => documentSearch.setQ(e.target.value)}
        onSearch={handleSearch}
      />

      {/* Split responsive */}
      <div className="split docs-split-top">
        {/* Lista de documentos */}
        <DocumentList
          items={documentSearch.items}
          selected={documentSearch.selected}
          loading={documentSearch.loading}
          onSelect={documentSearch.setSelected}
        />

        {/* Visor de documentos */}
        <DocumentViewer
          selected={documentSearch.selected}
          fileUrl={documentViewer.fileUrl}
          fileMeta={documentViewer.fileMeta}
          loadingFile={documentViewer.loadingFile}
        />
      </div>
    </Layout>
  );
}