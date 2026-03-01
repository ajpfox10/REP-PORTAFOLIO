// src/pages/CargaAgentePage/hooks/useCamera.ts
import { useState, useCallback, useRef, useEffect } from 'react';

export type CameraDevice = {
  deviceId: string;
  label: string;
};

export type CapturedPhoto = {
  id: string;
  dataUrl: string;    // base64 JPEG para preview
  blob: Blob;
  width: number;
  height: number;
};

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [active, setActive] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [mirrored, setMirrored] = useState(true);

  /** Enumerar cámaras USB disponibles */
  const enumerateDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = all
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Cámara ${i + 1}`,
        }));
      setDevices(cameras);
      // Si hay cámara USB y ninguna seleccionada, elegir la última (suelen ser las externas)
      if (cameras.length && !selectedDevice) {
        setSelectedDevice(cameras[cameras.length - 1].deviceId);
      }
      return cameras;
    } catch {
      return [];
    }
  }, [selectedDevice]);

  /** Iniciar stream de cámara */
  const startCamera = useCallback(async (deviceId?: string) => {
    setError(null);
    // Parar stream previo
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 960 },
        facingMode: deviceId ? undefined : 'user',
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setPermission('granted');
      setActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Actualizar lista de devices con labels reales (solo disponibles después de getUserMedia)
      await enumerateDevices();
    } catch (e: any) {
      const msg = e.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Habilitá el acceso en el navegador.'
        : e.name === 'NotFoundError'
        ? 'No se encontró ninguna cámara conectada.'
        : `Error de cámara: ${e.message}`;
      setError(msg);
      setPermission(e.name === 'NotAllowedError' ? 'denied' : 'unknown');
      setActive(false);
    }
  }, [enumerateDevices]);

  /** Detener cámara */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  /** Capturar foto del stream de video */
  const capture = useCallback((): CapturedPhoto | null => {
    const video = videoRef.current;
    if (!video || !active) return null;

    const canvas = canvasRef.current || document.createElement('canvas');
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d')!;

    // Si está espejado, voltear horizontalmente para guardar correcto
    if (mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Canvas to Blob
    return new Promise<CapturedPhoto>((resolve) => {
      canvas.toBlob(blob => {
        if (!blob) return resolve(null as any);
        const p: CapturedPhoto = {
          id: `photo_${Date.now()}`,
          dataUrl,
          blob,
          width: w,
          height: h,
        };
        setPhoto(p);
        resolve(p);
      }, 'image/jpeg', 0.92);
    }) as any;
  }, [active, mirrored]);

  /** Capturar de forma async */
  const captureAsync = useCallback((): Promise<CapturedPhoto | null> => {
    const video = videoRef.current;
    if (!video || !active) return Promise.resolve(null);

    const canvas = document.createElement('canvas');
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d')!;
    if (mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);

    return new Promise((resolve) => {
      canvas.toBlob(blob => {
        if (!blob) return resolve(null);
        const p: CapturedPhoto = {
          id: `photo_${Date.now()}`,
          dataUrl: canvas.toDataURL('image/jpeg', 0.92),
          blob,
          width: w,
          height: h,
        };
        setPhoto(p);
        resolve(p);
      }, 'image/jpeg', 0.92);
    });
  }, [active, mirrored]);

  /** Cargar foto desde archivo (fallback sin cámara) */
  const loadFromFile = useCallback((file: File): Promise<CapturedPhoto | null> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => {
          if (!blob) return resolve(null);
          const p: CapturedPhoto = {
            id: `photo_file_${Date.now()}`,
            dataUrl: canvas.toDataURL('image/jpeg', 0.92),
            blob,
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          setPhoto(p);
          resolve(p);
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }, []);

  const clearPhoto = useCallback(() => setPhoto(null), []);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Escuchar cambios de dispositivos (plug/unplug)
  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
  }, [enumerateDevices]);

  return {
    videoRef,
    canvasRef,
    devices,
    selectedDevice,
    setSelectedDevice,
    active,
    photo,
    error,
    permission,
    mirrored,
    setMirrored,
    enumerateDevices,
    startCamera,
    stopCamera,
    captureAsync,
    loadFromFile,
    clearPhoto,
  };
}
