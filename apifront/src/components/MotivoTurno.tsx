// src/components/MotivoTurno.tsx
// Motivo del turno de la Agenda de turnos (mig 135): lista fija + "Otro" con texto escrito.
// La lista la manda el backend (/agenda-turnos/config → motivos); esta es solo la de respaldo.
import React from 'react';

export const MOTIVOS_TURNO = ['Jubilación', 'Entrega de papeles', 'Nacimiento', 'Apelación de licencia', 'Otro'];

export interface MotivoValor { motivo: string; otro: string }
export const MOTIVO_VACIO: MotivoValor = { motivo: '', otro: '' };

/** true si se puede mandar (con `obligatorio`, tiene que haber motivo; "Otro" siempre pide texto). */
export const motivoCompleto = (v: MotivoValor, obligatorio: boolean) =>
  v.motivo === 'Otro' ? !!v.otro.trim() : (!obligatorio || !!v.motivo);

/** Lo que va en el body: { motivo, motivo_otro } */
export const motivoBody = (v: MotivoValor) => ({ motivo: v.motivo || null, motivo_otro: v.motivo === 'Otro' ? v.otro.trim() : null });

export function MotivoTurnoSelect({ value, onChange, motivos, sinMotivoTexto, style }: {
  value: MotivoValor; onChange: (v: MotivoValor) => void; motivos?: string[];
  /** texto de la opción vacía (si no se pasa, el motivo es obligatorio y dice "Motivo…") */
  sinMotivoTexto?: string; style?: React.CSSProperties;
}) {
  const lista = motivos?.length ? motivos : MOTIVOS_TURNO;
  return (
    <>
      <select value={value.motivo} onChange={(e) => onChange({ motivo: e.target.value, otro: value.otro })} style={style}>
        <option value="">{sinMotivoTexto || 'Motivo…'}</option>
        {lista.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      {value.motivo === 'Otro' && (
        <input value={value.otro} maxLength={150} onChange={(e) => onChange({ motivo: 'Otro', otro: e.target.value })}
          placeholder="Escribí el motivo" style={style} autoFocus />
      )}
    </>
  );
}
