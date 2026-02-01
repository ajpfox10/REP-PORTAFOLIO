// src/pages/DocumentsPage/hooks/useDocumentViewer.ts
import { useState, useEffect, useRef } from 'react';
import { apiFetchBlobWithMeta } from '../../../api/http';
import type { ApiError } from '../../../api/http';

export function useDocumentViewer(selectedDoc: any) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ contentType: string; filename: string | null } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  
  const prevUrlRef = useRef<string | null>(null);

  // Limpiar URL anterior
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
    };
  }, []);

  // Cargar archivo cuando cambia selectedDoc
  useEffect(() => {
    let alive = true;
    
    async function loadFile() {
      if (!selectedDoc) {
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        setFileUrl(null);
        setFileMeta(null);
        return;
      }
      
      try {
        setLoadingFile(true);
        const { blob, contentType, filename } = await apiFetchBlobWithMeta(selectedDoc.fileUrl);
        
        if (!alive) return;
        
        // Limpiar URL anterior
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        
        const url = URL.createObjectURL(blob);
        prevUrlRef.current = url;
        
        setFileMeta({ contentType, filename });
        setFileUrl(url);
      } catch (e: any) {
        if (!alive) return;
        throw { message: e?.message || 'Error cargando archivo' } as ApiError;
      } finally {
        if (alive) setLoadingFile(false);
      }
    }
    
    loadFile();
    
    return () => {
      alive = false;
    };
  }, [selectedDoc]);

  return {
    // Estado
    fileUrl,
    fileMeta,
    loadingFile,
    
    // Helpers
    hasFile: !!fileUrl,
    canDownload: !!fileUrl,
    canOpen: !!fileUrl,
  };
}