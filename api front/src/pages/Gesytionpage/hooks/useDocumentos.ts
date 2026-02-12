// hooks/useDocumentos.ts
import { useState, useCallback, useRef } from 'react';
import { useToast } from "../../../ui/toast";
import { apiFetchBlob, apiFetchBlobWithMeta } from '../../../api/http';
import { trackAction } from '../../../logging/track';

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

  /**
   * 🐉 NORMALIZACIÓN DE RUTAS - VERSIÓN DEFINITIVA
   * 
   * ✅ SIEMPRE usar ID numérico → /documents/:id/file
   * ✅ HTTP/HTTPS → absoluto
   * ❌ UNC directa → ERROR (no se puede en navegador)
   */
  const normalizeDocRoute = useCallback((route: string) => {
    const r = String(route || '').trim();
    if (!r) return { kind: 'error', value: 'Ruta vacía' };

    // ✅ Si es ID numérico → endpoint correcto (EL QUE FUNCIONA)
    if (/^\d+$/.test(r)) {
      return { kind: 'api', value: `/documents/${r}/file` };
    }

    // ✅ URL absoluta HTTP/S
    if (/^https?:\/\//i.test(r)) {
      return { kind: 'absolute', value: r };
    }

    // ❌ UNC directa (\\server\share o //server/share)
    if (/^\\\\[^\\]+\\/.test(r) || /^\/\/[^\/]+\//.test(r)) {
      return { 
        kind: 'error', 
        value: 'Ruta de red no accesible directamente. Usá el ID del documento.' 
      };
    }

    // ⚠️ Ruta de API relativa (fallback, no recomendado)
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

  /**
   * 🐉 ABRIR VISOR DE DOCUMENTOS - VERSIÓN CORREGIDA
   * 
   * @param identifier - DEBE ser el ID numérico del documento
   * @param rowRef - Fila completa (para metadata)
   */
  const openDocViewer = useCallback(async (identifier: string, rowRef: any) => {
    const norm = normalizeDocRoute(identifier);
    
    trackAction('gestion_document_open', {
      dni: Number(cleanDni),
      identifier,
      kind: norm.kind,
      hasId: /^\d+$/.test(identifier)
    });

    // Limpiar URL anterior
    setDocViewer((prev) => {
      if (prev.objectUrl && prev.objectUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(prev.objectUrl); } catch { /* noop */ }
      }
      return {
        open: true,
        route: identifier,
        row: rowRef ?? null,
        objectUrl: null,
        meta: null,
        loading: true,
        error: null
      };
    });

    // ❌ Si es error (UNC directa) → mostrar mensaje claro
    if (norm.kind === 'error') {
      setDocViewer((prev) => ({
        ...prev,
        loading: false,
        error: norm.value
      }));
      toast.error('No se pudo abrir el archivo', norm.value);
      return;
    }

    // ✅ URL absoluta (sin auth)
    if (norm.kind === 'absolute') {
      setDocViewer((prev) => ({
        ...prev,
        objectUrl: norm.value,
        loading: false,
        meta: { 
          contentType: '', 
          filename: rowRef?.nombre || identifier.split('/').pop() || null 
        }
      }));
      return;
    }

    // ✅ URL de API con auth (EL CORRECTO: /documents/:id/file)
    try {
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(norm.value);
      const url = URL.createObjectURL(blob);
      
      setDocViewer((prev) => ({
        ...prev,
        objectUrl: url,
        loading: false,
        meta: { 
          contentType, 
          filename: filename || rowRef?.nombre || `documento-${identifier}.pdf`
        },
        error: null
      }));
      
      trackAction('gestion_document_open_ok', {
        dni: Number(cleanDni),
        identifier,
        bytes: blob.size,
        contentType
      });
      
    } catch (e: any) {
      setDocViewer((prev) => ({
        ...prev,
        loading: false,
        error: e?.message || 'No se pudo abrir el archivo'
      }));
      
      toast.error('No se pudo abrir el archivo', e?.message || 'Error');
      
      trackAction('gestion_document_open_error', {
        dni: Number(cleanDni),
        identifier,
        message: e?.message
      });
    }
  }, [cleanDni, normalizeDocRoute, toast]);

  const openCertificadoIoma = useCallback(async () => {
    if (!cleanDni) {
      toast.error('Primero cargá un DNI', 'Ingresá un DNI válido');
      return;
    }

    const endpoint = `/certificados/certificado-trabajo`;
    
    trackAction('gestion_certificado_ioma_open', { 
      dni: Number(cleanDni),
      endpoint 
    });

    setDocViewer((prev) => {
      if (prev.objectUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return {
        open: true,
        route: endpoint,
        row: null,
        objectUrl: null,
        meta: null,
        loading: true,
        error: null
      };
    });

    try {
      const { blob, contentType, filename } = await apiFetchBlobWithMeta(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dni: Number(cleanDni) }),
      });

      const url = URL.createObjectURL(blob);
      
      setDocViewer((prev) => ({
        ...prev,
        objectUrl: url,
        loading: false,
        meta: {
          contentType: contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: filename || `certificado_ioma_${cleanDni}.docx`,
        },
        error: null
      }));

      trackAction('gestion_certificado_ioma_open_ok', { 
        dni: Number(cleanDni), 
        bytes: blob.size 
      });

    } catch (e: any) {
      setDocViewer((prev) => ({
        ...prev,
        loading: false,
        error: e?.message || 'No se pudo generar el certificado'
      }));
      
      toast.error('No se pudo generar el certificado', e?.message || 'Error');
      
      trackAction('gestion_certificado_ioma_open_error', { 
        dni: Number(cleanDni), 
        message: e?.message 
      });
    }
  }, [cleanDni, toast]);

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

  return {
    // Estado
    fotoUrl,
    docViewer,

    // Acciones principales
    fetchFotoPrivada,
    openDocViewer,
    openCertificadoIoma,
    closeDocViewer,
    revokeLastObjectUrl,

    // Helpers
    isDocumentOpen: docViewer.open,
    hasFoto: !!fotoUrl,
  };
}