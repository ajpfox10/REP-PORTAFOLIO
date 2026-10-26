// Excel del presentismo por turno: una pestaña por día (tabla sector × turno + detalle por
// agente) y, si hay más de un día, una pestaña "Resumen" con los totales de cada día.
// Respeta los filtros de la página (sectores y turno): recibe los registros ya filtrados.
import * as XLSX from 'xlsx';

export interface RegistroX {
  fecha: string; dni: string; turno: string; horario: string; estado: string;
  novedad: { detalle: string; desde: string; hasta: string } | null;
  fichada: { primera: string; ultima: string } | null;
}

interface Opciones {
  dias: string[];
  registros: RegistroX[];                     // sin los ROT (no son teóricos)
  rotados: RegistroX[];                       // ROT: van solo al detalle
  cats: { k: string; label: string }[];
  turnos: string[];
  ordenSectores: string[];
  sectorDe: (dni: string) => string;
  nombreDe: (dni: string) => string;
  nombreSector: (s: string) => string;
  fmtDia: (iso: string) => string;
  servicio: string;
  feriados: { fecha: string; nombre: string }[];
  archivo: string;
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function exportarPresentismo(o: Opciones) {
  const label = Object.fromEntries(o.cats.map(c => [c.k, c.label]));
  const cuenta = (rs: RegistroX[], k: string) => rs.filter(r => r.estado === k).length;
  // mismas columnas en todas las pestañas: las novedades que aparecen en el período exportado
  const cols = o.cats.filter(c => o.registros.some(r => r.estado === c.k));
  const encabezado = ['Sector', 'Turno', 'Teóricos', ...cols.map(c => c.label)];
  const fila = (sector: string, turno: string, rs: RegistroX[]) => [sector, turno, rs.length, ...cols.map(c => cuenta(rs, c.k) || '')];

  const wb = XLSX.utils.book_new();
  const dias = o.dias.filter(f => o.registros.some(r => r.fecha === f) || o.rotados.some(r => r.fecha === f));

  if (dias.length > 1) {
    const filas: any[][] = [[`Presentismo por turno — ${o.servicio}`], [`Del ${fmt(dias[0])} al ${fmt(dias[dias.length - 1])}`], [],
      ['Día', 'Teóricos', ...cols.map(c => c.label)]];
    for (const f of dias) {
      const rs = o.registros.filter(r => r.fecha === f);
      filas.push([o.fmtDia(f), rs.length, ...cols.map(c => cuenta(rs, c.k) || '')]);
    }
    filas.push(['Total', o.registros.filter(r => dias.includes(r.fecha)).length,
      ...cols.map(c => cuenta(o.registros.filter(r => dias.includes(r.fecha)), c.k) || '')]);
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 14 }, { wch: 9 }, ...cols.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'Resumen');
  }

  for (const f of dias) {
    const regs = o.registros.filter(r => r.fecha === f);
    const fer = o.feriados.find(x => x.fecha === f);
    const filas: any[][] = [
      [`${o.servicio} — ${o.fmtDia(f)} (${fmt(f)})${fer ? ` — Feriado: ${fer.nombre}` : ''}`],
      // por agente (el de 06–18 tiene una fila en Mañana y otra en Tarde)
      [`${new Set(regs.filter(r => r.estado === 'FICHO').map(r => r.dni)).size}/${new Set(regs.map(r => r.dni)).size} ficharon`
        + `${cuenta(regs, 'SIN') ? ` · ${new Set(regs.filter(r => r.estado === 'SIN').map(r => r.dni)).size} sin fichaje ni novedad` : ''}`],
      [],
      encabezado,
    ];
    for (const s of o.ordenSectores) {
      let primero = true;
      for (const t of o.turnos) {
        const rs = regs.filter(r => o.sectorDe(r.dni) === s && r.turno === t);
        if (!rs.length) continue;
        filas.push(fila(primero ? o.nombreSector(s) : '', t, rs));
        primero = false;
      }
    }
    for (const t of o.turnos) {
      const rs = regs.filter(r => r.turno === t);
      if (rs.length) filas.push(fila('Total', t, rs));
    }
    if (regs.length) filas.push(fila('Total del día', '', regs));

    // detalle por agente: lo mismo que se despliega al hacer click en cada fila
    filas.push([], ['Detalle por agente'], ['Sector', 'Turno', 'Agente', 'DNI', 'Horario', 'Estado', 'Detalle']);
    const detalle = [...regs, ...o.rotados.filter(r => r.fecha === f)];
    const ordenSec = (s: string) => { const i = o.ordenSectores.indexOf(s); return i < 0 ? 999 : i; };
    detalle.sort((a, b) => ordenSec(o.sectorDe(a.dni)) - ordenSec(o.sectorDe(b.dni))
      || o.turnos.indexOf(a.turno) - o.turnos.indexOf(b.turno)
      || o.nombreDe(a.dni).localeCompare(o.nombreDe(b.dni), 'es'));
    for (const r of detalle) {
      const estado = r.estado === 'ROT' ? 'No le tocaba (rotación)' : label[r.estado] ?? r.estado;
      const det = r.estado === 'FICHO'
        ? `Entrada ${r.fichada?.primera ?? '—'}${r.fichada && r.fichada.ultima !== r.fichada.primera ? ` · Salida ${r.fichada.ultima}` : ''}`
        : r.novedad
          ? `${r.novedad.detalle} (${fmt(r.novedad.desde)}${r.novedad.hasta !== r.novedad.desde ? ` → ${fmt(r.novedad.hasta)}` : ''})`
          : r.estado === 'SIN' ? 'No fichó y no tiene novedad'
          : r.estado === 'ROT' ? 'Franco de rotación (no cuenta como teórico)'
          : r.estado === 'NOSIAPE' ? 'El historial de SIAPE todavía no llega a este día'
          : r.estado === 'PSF' ? 'SIAPE lo da presente pero no hay marca en el reloj' : '';
      filas.push([o.nombreSector(o.sectorDe(r.dni)), r.turno, o.nombreDe(r.dni), r.dni, r.horario, estado, det]);
    }

    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 30 }, { wch: 9 }, { wch: 32 }, { wch: 11 }, { wch: 13 }, { wch: 22 }, { wch: 50 },
      ...cols.slice(5).map(() => ({ wch: 12 }))];
    // nombre de pestaña: sin '/' (Excel no lo acepta) y único
    XLSX.utils.book_append_sheet(wb, ws, `${o.fmtDia(f).replace('/', '-')}`);
  }

  if (!wb.SheetNames.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Sin datos para exportar']]), 'Sin datos');
  XLSX.writeFile(wb, o.archivo);
}
