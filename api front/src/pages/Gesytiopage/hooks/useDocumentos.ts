// hooks/useDocumentos.ts
import { useState, useCallback, useRef } from 'react';
import { useToast } from '../ui/toast';
import { apiFetchBlob, apiFetchBlobWithMeta } from '../api/http';
import { trackAction } from '../logging/track';

export function useDocumentos(cleanDni: string) {
  const toast = useToast();
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [docViewer, setDocViewer] = useState({
    open: false,
    route: '',
    row: null as any,
    objectUrl: null as string | null,
    meta: null as { contentType: string; filename: string | null } | null,
    loading: false,
    error: null as string | null,
  });
  
  const lastObjectUrlRef = useRef<string | null>(null);

  const revokeLastObjectUrl = useCallback(() => {
    if (lastObjectUrlRef.current) {
      URL.revokeObjectURL(lastObjectUrlRef.current);
      lastObjectUrlRef.current = null;
    }
  }, []);

  const normalizeDocRoute = useCallback((route: string) => {
    const r = String(route || '').trim();
    if (!r) return { kind: 'api', value: '/' };
    if (/^https?:\/\//i.test(r)) return { kind: 'absolute', value: r };
    return { kind: 'api', value: r.startsWith('/') ? r : `/${r}` };
  }, []);

  const fetchFotoPrivada = useCallback(async (dniValue: string) => {
    revokeLastObjectUrl();
    setFotoUrl(null);

    try {
      const clean = dniValue.replace(/\D/g, "");
      const blob = await apiFetchBlob(`/agentes/${clean}/foto`);
      const objUrl = URL.createObjectURL(blob);
      lastObjectUrlRef.current = objUrl;
      setFotoUrl(objUrl);
    } catch (err) {
      console.log("❌ Error cargando foto:", err);
      setFotoUrl(null);
      throw err;
    }
  }, [revokeLastObjectUrl]);

  const openDocViewer = useCallback(async (route: string, rowRef: any) => {
    const norm = normalizeDocRoute(route);
    trackAction('gestion_document_open', { 
      dni: Number(cleanDni), 
      route, 
      kind: norm.kind 
    });

    // Limpiar URL anterior
    setDocViewer((prev) => {
      if (prev.objectUrl && prev.objectUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev.objectUrl); } catch { /* noop */ }
      }
      return { 
        open: true, 
        route, 
        row: rowRef ?? null, 
        objectUrl: null, 
        meta: null, 
        loading: true, 
        error: null 
      };
    });

    // URL absoluta (sin auth)
    if (norm.kind === 'absolute') {
      setDocViewer((prev) => ({ 
        ...prev, 
        objectUrl: norm.value, 
        loading: false, 
        meta: { contentType: '', filename: (route.split('/').pop() || null) } 
      }));
      return;
    }

    // URL de API (con auth)
    try {
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(norm.value);
      const url = URL.createObjectURL(blob);
      setDocViewer((prev) => ({ 
        ...prev, 
        objectUrl: url, 
        loading: false, 
        meta: { contentType, filename: filename || (route.split('/').pop() || null) }, 
        error: null 
      }));
    } catch (e: any) {
      setDocViewer((prev) => ({ 
        ...prev, 
        loading: false, 
        error: e?.message || 'No se pudo abrir el archivo' 
      }));
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
      trackAction('gestion_document_open_error', { 
        dni: Number(cleanDni), 
        route, 
        message: e?.message 
      });
    }
  }, [cleanDni, normalizeDocRoute, toast]);

  const closeDocViewer = useCallback(() => {
    setDocViewer((prev) => {
      if (prev.objectUrl && prev.objectUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev.objectUrl); } catch { /* noop */ }
      }
      return { 
        open: false, 
        route: '', 
        row: null, 
        objectUrl: null, 
        meta: null, 
        loading: false, 
        error: null 
      };
    });
  }, []);

  // Limpiar recursos al desmontar
  const cleanup = useCallback(() => {
    revokeLastObjectUrl();
    if (docViewer.objectUrl) {
      URL.revokeObjectURL(docViewer.objectUrl);
    }
  }, [docViewer.objectUrl, revokeLastObjectUrl]);

  return {
    // Estado
    fotoUrl,
    docViewer,
    
    // Acciones
    fetchFotoPrivada,
    openDocViewer,
    closeDocViewer,
    revokeLastObjectUrl,
    
    // Helpers
    cleanup,
    isDocumentOpen: docViewer.open,
  };
}