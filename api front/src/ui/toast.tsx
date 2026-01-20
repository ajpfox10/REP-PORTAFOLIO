import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type ToastKind = 'ok' | 'err';

type ToastItem = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
};

type ToastApi = {
  ok: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item: ToastItem = { id, kind, title, message };
    setItems((p) => [item, ...p].slice(0, 5));
    window.setTimeout(() => {
      setItems((p) => p.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      ok: (t, m) => push('ok', t, m),
      error: (t, m) => push('err', t, m),
    }),
    [push]
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'ok' ? 'ok' : 'err'}`}>
            <div className="title">{t.title}</div>
            {t.message ? <div className="msg">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}
