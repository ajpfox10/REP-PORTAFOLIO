// src/pages/CargaAgentePage/hooks/useScanner.ts
import { useState, useCallback, useEffect } from 'react';

export type Scanner = {
  id: string;
  name: string;
  demo?: boolean;
};

export type ScanOptions = {
  scanner: string;
  dpi: number;
  color: 'color' | 'gray' | 'bw';
  format: 'jpeg' | 'pdf';
  quality?: number;
};

export type ScanResult = {
  id: string;
  data: string;        // base64
  mime: string;
  format: string;
  dpi: number;
  label?: string;      // nombre que le da el usuario
  demo?: boolean;
};

export type ScannerStatus = 'disconnected' | 'connecting' | 'connected' | 'scanning' | 'error';

const DEFAULT_AGENT = 'http://127.0.0.1:9100';

export function useScanner() {
  const [agentUrl, setAgentUrl] = useState(DEFAULT_AGENT);
  const [status, setStatus] = useState<ScannerStatus>('disconnected');
  const [scanners, setScanners] = useState<Scanner[]>([]);
  const [selectedScanner, setSelectedScanner] = useState<string>('');
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Omit<ScanOptions, 'scanner'>>({
    dpi: 200,
    color: 'gray',
    format: 'pdf',
    quality: 85,
  });

  const connect = useCallback(async (url?: string) => {
    const base = (url || agentUrl).replace(/\/+$/, '');
    setStatus('connecting');
    setError(null);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const health = await res.json();
      if (!health.ok) throw new Error('Agente no disponible');

      setAgentUrl(base);
      setStatus('connected');

      // Cargar escáneres
      const scanRes = await fetch(`${base}/scanners`);
      const scanData = await scanRes.json();
      const list: Scanner[] = scanData.data || [];
      setScanners(list);
      if (list.length && !selectedScanner) {
        setSelectedScanner(list[0].id);
      }
    } catch (e: any) {
      setStatus('error');
      setError(`No se pudo conectar al agente scanner en ${base}. ¿Está iniciado?`);
    }
  }, [agentUrl, selectedScanner]);

  const refreshScanners = useCallback(async () => {
    if (status !== 'connected') return;
    try {
      const res = await fetch(`${agentUrl}/scanners`);
      const data = await res.json();
      const list: Scanner[] = data.data || [];
      setScanners(list);
      if (list.length && !selectedScanner) setSelectedScanner(list[0].id);
    } catch {}
  }, [agentUrl, status, selectedScanner]);

  const scan = useCallback(async (label?: string): Promise<ScanResult | null> => {
    if (!selectedScanner) {
      setError('Seleccioná un escáner');
      return null;
    }
    setStatus('scanning');
    setError(null);
    try {
      const res = await fetch(`${agentUrl}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanner: selectedScanner, ...opts }),
        signal: AbortSignal.timeout(120_000), // 2 min timeout para escáneres lentos
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error al escanear');

      const result: ScanResult = {
        id: data.id || `scan_${Date.now()}`,
        data: data.data,
        mime: data.mime,
        format: data.format,
        dpi: data.dpi,
        label: label || `Escaneo ${scanResults.length + 1}`,
        demo: data.demo,
      };

      setScanResults(prev => [...prev, result]);
      setStatus('connected');
      return result;
    } catch (e: any) {
      setStatus('error');
      setError(e.message || 'Error al escanear');
      return null;
    }
  }, [agentUrl, selectedScanner, opts, scanResults.length]);

  /**
   * Procesar archivo/imagen existente → PDF o JPG via agente
   * Fallback para cuando no hay scanner de hardware pero querés
   * convertir una imagen a PDF
   */
  const processFile = useCallback(async (file: File, format: 'jpeg' | 'pdf', label?: string): Promise<ScanResult | null> => {
    const base64 = await fileToBase64(file);
    try {
      const res = await fetch(`${agentUrl}/scan/from-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64, format, quality: opts.quality }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const result: ScanResult = {
        id: data.id,
        data: data.data,
        mime: data.mime,
        format: data.format,
        dpi: opts.dpi,
        label: label || file.name,
      };
      setScanResults(prev => [...prev, result]);
      return result;
    } catch (e: any) {
      // Si el agente no está disponible, convertir en cliente
      const clientResult = await convertFileClient(file, format, label, scanResults.length);
      if (clientResult) setScanResults(prev => [...prev, clientResult]);
      return clientResult;
    }
  }, [agentUrl, opts, scanResults.length]);

  const removeScanResult = useCallback((id: string) => {
    setScanResults(prev => prev.filter(r => r.id !== id));
    // Limpiar del agente en background
    fetch(`${agentUrl}/scan/${id}`, { method: 'DELETE' }).catch(() => {});
  }, [agentUrl]);

  const clearAll = useCallback(() => {
    scanResults.forEach(r => {
      fetch(`${agentUrl}/scan/${r.id}`, { method: 'DELETE' }).catch(() => {});
    });
    setScanResults([]);
  }, [agentUrl, scanResults]);

  // Intentar conectar al iniciar
  useEffect(() => {
    connect();
  }, []);

  return {
    agentUrl, setAgentUrl,
    status, scanners, selectedScanner, setSelectedScanner,
    scanResults, error, opts, setOpts,
    connect, refreshScanners, scan, processFile,
    removeScanResult, clearAll,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Conversión client-side sin agente:
 * - JPG: canvas → dataURL
 * - PDF: usa jsPDF si está disponible, si no devuelve JPG
 */
async function convertFileClient(
  file: File, format: 'jpeg' | 'pdf', label?: string, index?: number
): Promise<ScanResult | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const jpgData = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      URL.revokeObjectURL(url);

      resolve({
        id: `client_${Date.now()}`,
        data: jpgData,
        mime: 'image/jpeg',
        format: 'jpeg', // siempre jpeg si no hay agente
        dpi: 200,
        label: label || file.name,
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
