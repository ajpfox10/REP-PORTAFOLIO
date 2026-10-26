// src/pages/NormativaPage/index.tsx
// Normativa de los plus de Guardia y de Planta (Ley 10471, Carrera Profesional Hospitalaria).
// Los PDF son copias oficiales de normas.gba.gob.ar en public/normativa (bajados 20/10/2026).
// Los que el portal no tiene escaneados (398/89, 2395/89, 1503/05, 4508/89, 3099/88, 6229/89)
// son el "texto actualizado" oficial impreso a PDF.
// Acceso: admin (crud:*:*) y rol reader (app:normativa:access).
import React, { useMemo, useState } from 'react';
import { Layout } from '../../components/Layout';

type Tab = 'guardia' | 'planta' | 'pdf';
type Tema = 'Guardia' | 'Planta' | 'Salarial' | 'Otros';

interface Norma {
  archivo: string;
  nombre: string;
  fecha: string;
  tema: Tema;
  resumen: string;
  textoActualizado?: boolean;
}

const NORMAS: Norma[] = [
  { archivo: 'Ley_10471.pdf', nombre: 'Ley 10.471', fecha: '1986', tema: 'Otros', resumen: 'Carrera Profesional Hospitalaria.' },
  { archivo: 'Decreto_6315-1988.pdf', nombre: 'Decreto 6315/88', fecha: '01/12/1988', tema: 'Planta', resumen: 'Bonificación de presentismo (A 500). Limitada desde el 01/02/1990 por el Dto 145/90.' },
  { archivo: 'Decreto_398-1989.pdf', nombre: 'Decreto 398/89', fecha: '01/01/1989', tema: 'Guardia', resumen: 'Crea la bonificación por guardia (30% L-V, 50% fin de semana, 40% SIES) y las reglas de asistencia (art. 2).', textoActualizado: true },
  { archivo: 'Decreto_2395-1989.pdf', nombre: 'Decreto 2395/89', fecha: '01/06/1989', tema: 'Guardia', resumen: 'La guardia se paga con valores del mes de liquidación, junto con los haberes.', textoActualizado: true },
  { archivo: 'Decreto_4507-1989.pdf', nombre: 'Decreto 4507/89', fecha: '01/09/1989', tema: 'Guardia', resumen: 'Sube 10 puntos los porcentajes de guardia.' },
  { archivo: 'Decreto_4508-1989.pdf', nombre: 'Decreto 4508/89', fecha: '01/09/1989', tema: 'Planta', resumen: 'Bonificación por tarea crítica profesional: 25% del básico.', textoActualizado: true },
  { archivo: 'Decreto_4204-1989.pdf', nombre: 'Decreto 4204/89', fecha: '01/09/1989', tema: 'Planta', resumen: 'Bonificación de movilidad de la Administración: base de las reglas de asistencia que usa la bonificación de planta.' },
  { archivo: 'Decreto_5723-1989.pdf', nombre: 'Decreto 5723/89', fecha: '01/12/1989', tema: 'Guardia', resumen: 'Guardia 60/80/70%. Art. 2: primeras licencias que no cuentan como inasistencia.' },
  { archivo: 'Decreto_145-1990.pdf', nombre: 'Decreto 145/90', fecha: '01/01/1990', tema: 'Planta', resumen: 'Crea la bonificación de planta (30%) y lleva la tarea crítica al 35%.' },
  { archivo: 'Decreto_934-1990.pdf', nombre: 'Decreto 934/90', fecha: '01/01/1990', tema: 'Guardia', resumen: 'Guardia de 12 horas semanales: 50% de los porcentajes de la de 24 h.' },
  { archivo: 'Decreto_164-1996.pdf', nombre: 'Decreto 164/96', fecha: '1996', tema: 'Guardia', resumen: 'Amplía el art. 2 del Dto 398/89 (modificado por el 5723/89).' },
  { archivo: 'Decreto_1503-2005.pdf', nombre: 'Decreto 1503/05', fecha: '01/05/2005', tema: 'Guardia', resumen: 'Porcentaje según cantidad de guardias y tipo de día. Cambio de día de guardia con Disposición y 30 días de aviso.', textoActualizado: true },
  { archivo: 'Decreto_374-2008.pdf', nombre: 'Decreto 374/08', fecha: '17/03/2008', tema: 'Guardia', resumen: 'Enfermedad: 1 guardia no afecta; 2 → 75%, 3 → 50%, 4 → 25%.' },
  { archivo: 'Decreto_375-2008.pdf', nombre: 'Decreto 375/08', fecha: '17/03/2008', tema: 'Planta', resumen: 'Licencias que no afectan la bonificación de planta y escala por días de enfermedad. La extiende a la planta temporaria.' },
  { archivo: 'Decreto_1427-2009.pdf', nombre: 'Decreto 1427/09', fecha: '01/03/2009', tema: 'Salarial', resumen: 'Guardia 70–110% (art. 5). Bonificación de planta al 40% (art. 6).' },
  { archivo: 'Decreto_1954-2010.pdf', nombre: 'Decreto 1954/10', fecha: '01/03/2010', tema: 'Salarial', resumen: 'Sueldos básicos 2010 y bonificación por régimen horario.' },
  { archivo: 'Decreto_1184-2011.pdf', nombre: 'Decreto 1184/11', fecha: '01/03/2011', tema: 'Salarial', resumen: 'Política salarial 2011.' },
  { archivo: 'Decreto_1446-2013.pdf', nombre: 'Decreto 1446/13', fecha: '01/12/2013', tema: 'Salarial', resumen: '10 puntos de guardia y de planta pasan a ser remunerativos.' },
  { archivo: 'Decreto_2265-2015.pdf', nombre: 'Decreto 2265/15', fecha: '01/01/2015', tema: 'Salarial', resumen: '20 puntos remunerativos en guardia y en planta. Planta: 20% NR + 20% R.' },
  { archivo: 'Decreto_73-2018.pdf', nombre: 'Decreto 73/18', fecha: '2016–2017', tema: 'Salarial', resumen: 'Política salarial 2016-2017 (sueldos básicos y bonificaciones fijas).' },
  { archivo: 'Decreto_449-2019.pdf', nombre: 'Decreto 449/19', fecha: '01/10/2016', tema: 'Salarial', resumen: 'Guardia: el componente remunerativo pasa a 22 puntos (tabla vigente).' },
  { archivo: 'Decreto_189-2022.pdf', nombre: 'Decreto 189/22', fecha: '23/02/2022', tema: 'Otros', resumen: 'Licencias parentales Ley 10471 (Acta 18/11/2021).' },
  { archivo: 'Decreto_1434-2023.pdf', nombre: 'Decreto 1434/23', fecha: '17/08/2023', tema: 'Salarial', resumen: 'Aprueba el Acta del 28/03/2022 (excepciones de inasistencia de guardia y planta).' },
  { archivo: 'Decreto_2008-2023.pdf', nombre: 'Decreto 2008/23', fecha: '06/11/2023', tema: 'Salarial', resumen: 'Aprueba las Actas del 06/01 y 08/03/2023. Bonificación Integral Salud 2023.' },
  { archivo: 'Decreto_14-2026.pdf', nombre: 'Decreto 14/2026', fecha: '01/05/2025', tema: 'Guardia', resumen: 'Acta del 25/03/2025: lista única de licencias que no cuentan para la guardia; planta al Director Ejecutivo.' },
  { archivo: 'Decreto_3099-1988.pdf', nombre: 'Decreto 3099/88', fecha: '1988', tema: 'Otros', resumen: 'Reintegro por guardería (personal femenino Ley 10430).', textoActualizado: true },
  { archivo: 'Decreto_6229-1989.pdf', nombre: 'Decreto 6229/89', fecha: '1989', tema: 'Otros', resumen: 'Extiende el reintegro por guardería al personal masculino.', textoActualizado: true },
  { archivo: 'Decreto_4023-1997.pdf', nombre: 'Decreto 4023/97', fecha: '1997', tema: 'Otros', resumen: 'Pago de haberes por Banco Provincia; baja de liquidación por cese (arts. 3, 6, 9 y 12).' },
  { archivo: 'Ley_13644.pdf', nombre: 'Ley 13.644', fecha: '21/02/2007', tema: 'Otros', resumen: 'Incompatibilidad: un cargo 10471 más otro de distinto régimen, sin superposición horaria.' },
  { archivo: 'Resolucion_100-2018_JGM.pdf', nombre: 'Resolución 100/18 (JGM)', fecha: '12/11/2018', tema: 'Otros', resumen: 'Licencia médica digital (fuera de La Plata, Berisso y Ensenada); certificado en 48 h.' },
];

// Bonificación por guardia vigente: Dto 449/19 desde el 01/10/2016 (base Dto 1427/09).
// Clave = `${laborables}-${noLaborables}`.
const GUARDIA_VIGENTE: { key: string; desc: string; regimen: 'L-V' | 'Fin de semana'; nr: number; r: number }[] = [
  { key: '4-0', desc: '4 en días laborables', regimen: 'L-V', nr: 50, r: 22 },
  { key: '5-0', desc: '5 en días laborables', regimen: 'L-V', nr: 65, r: 22 },
  { key: '3-1', desc: '4 (3 laborables + 1 no laborable)', regimen: 'L-V', nr: 55, r: 22 },
  { key: '2-2', desc: '4 (2 laborables + 2 no laborables)', regimen: 'L-V', nr: 60, r: 22 },
  { key: '4-1', desc: '5 (4 laborables + 1 no laborable)', regimen: 'L-V', nr: 70, r: 22 },
  { key: '0-5', desc: '5 en días no laborables', regimen: 'Fin de semana', nr: 90, r: 22 },
  { key: '0-4', desc: '4 en días no laborables', regimen: 'Fin de semana', nr: 70, r: 22 },
  { key: '1-3', desc: '4 (3 no laborables + 1 laborable)', regimen: 'Fin de semana', nr: 65, r: 22 },
  { key: '3-2', desc: '5 (2 no laborables + 3 laborables)', regimen: 'Fin de semana', nr: 75, r: 22 },
  { key: '1-4', desc: '5 (4 no laborables + 1 laborable)', regimen: 'Fin de semana', nr: 85, r: 22 },
  { key: '2-3', desc: '5 (3 no laborables + 2 laborables)', regimen: 'Fin de semana', nr: 80, r: 22 },
];
const SIES = { nr: 60, r: 22 };

// Evolución del porcentaje total "4 guardias en días laborables" (referencia).
const EVOLUCION_GUARDIA = [
  { desde: '01/01/1989', norma: 'Dto 398/89', texto: 'Único por régimen: 30% L-V · 50% fin de semana · 40% SIES' },
  { desde: '01/09/1989', norma: 'Dto 4507/89', texto: '+10 puntos: 40% · 60% · 50%' },
  { desde: '01/12/1989', norma: 'Dto 5723/89', texto: '60% · 80% · 70%' },
  { desde: '01/05/2005', norma: 'Dto 1503/05', texto: 'Según cantidad y tipo de día: 4 laborables 60% … 5 no laborables 100% · SIES 70%' },
  { desde: '01/03/2009', norma: 'Dto 1427/09', texto: '+10 puntos: 4 laborables 70% … 5 no laborables 110% · SIES 80%' },
  { desde: '01/12/2013', norma: 'Dto 1446/13', texto: 'Mismo total; 10 puntos remunerativos' },
  { desde: '01/01/2015', norma: 'Dto 2265/15', texto: 'Mismo total; 20 puntos remunerativos' },
  { desde: '01/10/2016', norma: 'Dto 449/19', texto: 'Parte remunerativa 22 puntos: total +2 (4 laborables 72% … 5 no laborables 112% · SIES 82%)' },
];

const EXCEPCIONES_GUARDIA = [
  'Licencia anual obligatoria y complementaria',
  'Enfermedad profesional o accidente de trabajo',
  'Enfermedad de hasta 1 guardia mensual (2 → 75%, 3 → 50%, 4 → 25%)',
  'Tratamiento de enfermedad oncológica',
  'Diálisis',
  'Tratamiento de enfermedades cardiovasculares y neurológicas agudas',
  'Embarazo de riesgo',
  'Nacimiento',
  'Cuidado de recién nacido/a',
  'Defunción fetal',
  'Fallecimiento de familiar (hasta 3° consanguinidad, 2° afinidad o cónyuge)',
  'Fallecimiento de corresponsable parental',
  'Donación de órganos',
  'Mujeres víctimas de violencia',
  'Tratamiento de fertilización asistida',
  'Matrimonio',
  'Adopción',
  'Abrigo de niño/a',
];

const EXCEPCIONES_PLANTA = [
  'a) Descanso anual',
  'b) Fallecimiento de familiar (hasta 3° consanguinidad, 2° afinidad o cónyuge)',
  'c) Matrimonio',
  'd) Maternidad',
  'e) Nacimiento de hijo (personal masculino)',
  'f) Licencia anual complementaria',
  'g) Adopción',
  'h) Enfermedad profesional o accidente de trabajo',
  'i) Examen médico para Fuerzas Armadas o de Seguridad',
  'j) Examen final de estudios universitarios o superiores',
  'k) Donación de órganos',
  'l) Enfermedad hasta 6 días/mes (12 → 75%, 18 → 50%, 24 → 25%)',
  'm) Una (1) inasistencia al mes, si no hubo ninguna de las anteriores',
  'n) Donación de sangre, aun junto con otras inasistencias',
];
const EXCEPCIONES_PLANTA_2022 = [
  'Licencia por enfermedad',
  'Fallecimiento de corresponsable parental de hijo menor de 18 o con discapacidad (hasta 45 días)',
  'Defunción fetal (15 a 45 días)',
  'Mujeres víctimas de violencia de género',
  'Fertilización asistida',
  'Cuidado de recién nacido/a',
  'Atención de familiar enfermo',
  'Franquicia por adaptación escolar de hijo/a',
];

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.12)' };
const td: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.86rem' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const card: React.CSSProperties = { marginTop: 12, padding: 16 };
const nota: React.CSSProperties = { fontSize: '0.78rem', marginTop: 8 };
const input: React.CSSProperties = { width: 70, padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'inherit' };

function Cita({ n }: { n: string }) {
  const norma = NORMAS.find((x) => x.nombre === n);
  if (!norma) return <b>{n}</b>;
  return (
    <a href={`/normativa/${norma.archivo}`} target="_blank" rel="noreferrer" style={{ color: '#93c5fd', fontWeight: 600 }}>
      {n}
    </a>
  );
}

function Lista({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 20, columns: 2, columnGap: 28, fontSize: '0.84rem', lineHeight: 1.6 }}>
      {items.map((x) => <li key={x}>{x}</li>)}
    </ul>
  );
}

function Resultado({ pct, detalle }: { pct: number | null; detalle: string[] }) {
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.35)' }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
        {pct === null ? 'Combinación no prevista' : `${pct.toLocaleString('es-AR', { maximumFractionDigits: 2 })}% del sueldo básico`}
      </div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.8rem' }} className="muted">
        {detalle.map((d) => <li key={d}>{d}</li>)}
      </ul>
    </div>
  );
}

function SimuladorGuardia() {
  const [lab, setLab] = useState(4);
  const [noLab, setNoLab] = useState(0);
  const [doce, setDoce] = useState(false);
  const [sies, setSies] = useState(false);
  const [enf, setEnf] = useState(0);
  const [injust, setInjust] = useState(0);

  const { pct, detalle } = useMemo(() => {
    const det: string[] = [];
    let base: { nr: number; r: number } | undefined;
    if (sies) {
      base = SIES;
      det.push('SIES: 60% no remunerativo + 22% remunerativo');
    } else {
      const fila = GUARDIA_VIGENTE.find((g) => g.key === `${lab}-${noLab}`);
      if (fila) {
        base = fila;
        det.push(`${fila.desc}: ${fila.nr}% NR + ${fila.r}% R (Dto 449/19)`);
      } else {
        det.push('Las normas solo prevén meses de 4 o 5 guardias en las combinaciones de la tabla.');
      }
    }
    if (!base) return { pct: null, detalle: det };
    let total = base.nr + base.r;
    if (doce) { total *= 0.5; det.push('Guardia de 12 h semanales: 50% (Dto 934/90)'); }
    if (enf >= 2) {
      const f = enf === 2 ? 0.75 : enf === 3 ? 0.5 : enf === 4 ? 0.25 : 0;
      total *= f;
      det.push(enf <= 4 ? `Enfermedad ${enf} guardias: se liquida el ${f * 100}% (Dto 374/08)` : `Enfermedad ${enf} guardias: la escala llega hasta 4; con más no se liquida (interpretación)`);
    } else if (enf === 1) {
      det.push('Enfermedad 1 guardia: no afecta');
    }
    if (injust === 1) { total *= 0.5; det.push('1 guardia inasistida sin justificar: 50% (Dto 398/89 art. 2 b)'); }
    if (injust > 1) { total = 0; det.push('Más de 1 guardia inasistida: no se percibe (Dto 398/89 art. 2 c)'); }
    if (enf >= 2 && injust >= 1) det.push('Enfermedad e inasistencias juntas: se aplican las dos reducciones (interpretación; la norma no lo aclara)');
    return { pct: Math.round(total * 100) / 100, detalle: det };
  }, [lab, noLab, doce, sies, enf, injust]);

  return (
    <div className="card" style={card}>
      <div className="h2" style={{ margin: 0, fontSize: '1rem' }}>🧮 Simulador del mes</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, alignItems: 'end' }}>
        <label>Guardias en días laborables<br /><input type="number" min={0} max={5} value={lab} disabled={sies} onChange={(e) => setLab(Number(e.target.value))} style={input} /></label>
        <label>Guardias en días no laborables<br /><input type="number" min={0} max={5} value={noLab} disabled={sies} onChange={(e) => setNoLab(Number(e.target.value))} style={input} /></label>
        <label>Guardias con licencia por enfermedad<br /><input type="number" min={0} max={5} value={enf} onChange={(e) => setEnf(Number(e.target.value))} style={input} /></label>
        <label>Guardias inasistidas sin justificar<br /><input type="number" min={0} max={5} value={injust} onChange={(e) => setInjust(Number(e.target.value))} style={input} /></label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={doce} onChange={(e) => setDoce(e.target.checked)} /> 12 h semanales</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={sies} onChange={(e) => setSies(e.target.checked)} /> SIES</label>
      </div>
      <Resultado pct={pct} detalle={detalle} />
      <div className="muted" style={nota}>Las licencias de la lista de excepciones (anual, accidente de trabajo, etc.) no se cargan acá porque no reducen nada.</div>
    </div>
  );
}

function SimuladorPlanta() {
  const [diasEnf, setDiasEnf] = useState(0);
  const [otras, setOtras] = useState(0);

  const { pct, detalle } = useMemo(() => {
    const det: string[] = ['Base: 40% del básico (20% NR + 20% R, Dto 2265/15)'];
    let total = 40;
    if (diasEnf > 0) {
      const f = diasEnf <= 6 ? 1 : diasEnf <= 12 ? 0.75 : diasEnf <= 18 ? 0.5 : diasEnf <= 24 ? 0.25 : 0;
      total *= f;
      det.push(diasEnf <= 6 ? `Enfermedad ${diasEnf} días: no afecta` : diasEnf <= 24 ? `Enfermedad ${diasEnf} días: se liquida el ${f * 100}% (Dto 375/08 inc. l)` : `Enfermedad ${diasEnf} días: la escala llega hasta 24; con más no se liquida (interpretación)`);
    }
    if (otras === 1 && diasEnf === 0) det.push('1 inasistencia sin otras licencias: tolerada (inc. m)');
    if (otras === 1 && diasEnf > 0) { total = 0; det.push('La inasistencia tolerada (inc. m) solo vale si no hubo otra licencia: se pierde (interpretación, Dto 4204/89 art. 2)'); }
    if (otras > 1) { total = 0; det.push('Más de 1 inasistencia fuera de las excepciones: se pierde (Dto 4204/89 art. 2, al que remite el 145/90)'); }
    return { pct: Math.round(total * 100) / 100, detalle: det };
  }, [diasEnf, otras]);

  return (
    <div className="card" style={card}>
      <div className="h2" style={{ margin: 0, fontSize: '1rem' }}>🧮 Simulador del mes</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, alignItems: 'end' }}>
        <label>Días de licencia por enfermedad<br /><input type="number" min={0} max={31} value={diasEnf} onChange={(e) => setDiasEnf(Number(e.target.value))} style={input} /></label>
        <label>Inasistencias fuera de las excepciones<br /><input type="number" min={0} max={31} value={otras} onChange={(e) => setOtras(Number(e.target.value))} style={input} /></label>
      </div>
      <Resultado pct={pct} detalle={detalle} />
      <div className="muted" style={nota}>
        Desde el Acta del 28/03/2022 la licencia por enfermedad figura entre las excepciones de planta. Si Liquidaciones ya no aplica la escala de 6/12/18/24 días, el resultado es 40% siempre: confirmalo con Delegación de Personal.
      </div>
    </div>
  );
}

function TabGuardia() {
  return (
    <>
      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Qué es</div>
        <p style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: '8px 0 0' }}>
          Bonificación para el profesional Ley 10.471 (planta permanente o temporaria) que hace <b>guardia con prestación efectiva</b> en el hospital
          (<Cita n="Decreto 398/89" />). Se calcula sobre el <b>sueldo básico del cargo de revista</b> y depende de <b>cuántas guardias</b> hizo en el mes
          y <b>en qué días</b> (<Cita n="Decreto 1503/05" />). Desde el <Cita n="Decreto 1446/13" /> una parte es remunerativa (con aportes, no bonificable)
          y el resto no remunerativa. No se usa para calcular otros adicionales.
        </p>
      </div>

      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Porcentajes vigentes · desde 01/10/2016 (<Cita n="Decreto 449/19" />)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead>
            <tr><th style={th}>Régimen</th><th style={th}>Guardias del mes</th><th style={{ ...th, textAlign: 'right' }}>No remun.</th><th style={{ ...th, textAlign: 'right' }}>Remun.</th><th style={{ ...th, textAlign: 'right' }}>Total</th></tr>
          </thead>
          <tbody>
            {GUARDIA_VIGENTE.map((g) => (
              <tr key={g.key}>
                <td style={td}>{g.regimen}</td><td style={td}>{g.desc}</td>
                <td style={tdNum}>{g.nr}%</td><td style={tdNum}>{g.r}%</td><td style={{ ...tdNum, fontWeight: 700 }}>{g.nr + g.r}%</td>
              </tr>
            ))}
            <tr>
              <td style={td}>SIES</td><td style={td}>Servicios Integrados de Emergencias Sanitarias Regionales</td>
              <td style={tdNum}>{SIES.nr}%</td><td style={tdNum}>{SIES.r}%</td><td style={{ ...tdNum, fontWeight: 700 }}>{SIES.nr + SIES.r}%</td>
            </tr>
          </tbody>
        </table>
        <div className="muted" style={nota}>
          Guardia de <b>12 horas semanales</b>: cobra el <b>50%</b> de estos porcentajes (<Cita n="Decreto 934/90" />). Los porcentajes del 1503/05 (60/75/…/100%)
          quedaron reemplazados en 2009 (<Cita n="Decreto 1427/09" />).
        </div>
      </div>

      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Asistencia: cuándo se reduce o se pierde</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <tbody>
            <tr><td style={td}>Sin inasistencias en el mes</td><td style={{ ...tdNum, fontWeight: 700 }}>100%</td><td style={td}><Cita n="Decreto 398/89" /> art. 2 a</td></tr>
            <tr><td style={td}>1 guardia inasistida (sin justificar)</td><td style={{ ...tdNum, fontWeight: 700 }}>50%</td><td style={td}>art. 2 b</td></tr>
            <tr><td style={td}>Más de 1 guardia inasistida</td><td style={{ ...tdNum, fontWeight: 700 }}>0%</td><td style={td}>art. 2 c</td></tr>
            <tr><td style={td}>Guardia partida en 2 de 12 h: cada mitad faltada es media inasistencia</td><td style={{ ...tdNum, fontWeight: 700 }}>−25%</td><td style={td}>art. 2 d</td></tr>
            <tr><td style={td}>Enfermedad 1 guardia</td><td style={{ ...tdNum, fontWeight: 700 }}>100%</td><td style={td} rowSpan={4}><Cita n="Decreto 374/08" /> · <Cita n="Decreto 14/2026" /> art. 4 c</td></tr>
            <tr><td style={td}>Enfermedad 2 guardias</td><td style={{ ...tdNum, fontWeight: 700 }}>75%</td></tr>
            <tr><td style={td}>Enfermedad 3 guardias</td><td style={{ ...tdNum, fontWeight: 700 }}>50%</td></tr>
            <tr><td style={td}>Enfermedad 4 guardias</td><td style={{ ...tdNum, fontWeight: 700 }}>25%</td></tr>
          </tbody>
        </table>
        <div className="h2" style={{ margin: '14px 0 0', fontSize: '0.95rem' }}>Licencias que NO cuentan como inasistencia (desde 01/05/2025, <Cita n="Decreto 14/2026" /> art. 4)</div>
        <Lista items={EXCEPCIONES_GUARDIA} />
        <div className="muted" style={nota}>
          Para que estas licencias no descuenten hay que cargarlas con su código en el Parte de Novedades. Por ejemplo: matrimonio 16, nacimiento 311, adopción 421, abrigo 422.
          Cambiar el día de la guardia requiere una Disposición del director, comunicada a Control de Asistencia con 30 días de anticipación (<Cita n="Decreto 1503/05" /> art. 4).
        </div>
      </div>

      <SimuladorGuardia />

      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Cómo fue cambiando</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr><th style={th}>Desde</th><th style={th}>Norma</th><th style={th}>Qué cambió</th></tr></thead>
          <tbody>
            {EVOLUCION_GUARDIA.map((e) => (
              <tr key={e.norma}><td style={td}>{e.desde}</td><td style={td}><Cita n={e.norma.replace('Dto', 'Decreto')} /></td><td style={td}>{e.texto}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TabPlanta() {
  return (
    <>
      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Qué es</div>
        <p style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: '8px 0 0' }}>
          "Bonificación Personal de Planta": compensatoria para el profesional Ley 10.471 que revista en <b>tareas de planta</b>, no de guardia,
          en establecimientos asistenciales (<Cita n="Decreto 145/90" /> art. 2). Desde el <Cita n="Decreto 375/08" /> alcanza también a la planta temporaria,
          y desde el 01/05/2025 al Director Ejecutivo de hospital descentralizado (<Cita n="Decreto 14/2026" /> art. 3). Se calcula sobre el sueldo básico del cargo
          y está sujeta a la asistencia.
        </p>
      </div>

      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Porcentaje vigente</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
          {[['20%', 'No remunerativo'], ['20%', 'Remunerativo no bonificable'], ['40%', 'Total sobre el básico']].map(([v, l]) => (
            <div key={l} style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{v}</div><div className="muted" style={{ fontSize: '0.78rem' }}>{l}</div>
            </div>
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead><tr><th style={th}>Desde</th><th style={th}>Norma</th><th style={th}>Porcentaje</th></tr></thead>
          <tbody>
            <tr><td style={td}>01/01/1990</td><td style={td}><Cita n="Decreto 145/90" /></td><td style={td}>30% no remunerativo (reemplaza el presentismo del Dto 6315/88)</td></tr>
            <tr><td style={td}>01/03/2009</td><td style={td}><Cita n="Decreto 1427/09" /> art. 6</td><td style={td}>40%</td></tr>
            <tr><td style={td}>01/12/2013</td><td style={td}><Cita n="Decreto 1446/13" /> art. 5</td><td style={td}>30% NR + 10% R</td></tr>
            <tr><td style={td}>01/01/2015</td><td style={td}><Cita n="Decreto 2265/15" /> art. 6</td><td style={{ ...td, fontWeight: 700 }}>20% NR + 20% R (vigente; lo ratifica el Dto 14/2026)</td></tr>
          </tbody>
        </table>
        <div className="muted" style={nota}>
          Aparte existe la bonificación por <b>tarea crítica profesional</b>: 25% (<Cita n="Decreto 4508/89" />), llevada al 35% por el <Cita n="Decreto 145/90" /> art. 1.
          No encontré ninguna norma posterior que la mencione, así que conviene confirmar en el recibo si se sigue liquidando.
        </div>
      </div>

      <div className="card" style={card}>
        <div className="h2" style={{ margin: 0, fontSize: '1.05rem' }}>Licencias que NO afectan la bonificación (<Cita n="Decreto 375/08" /> art. 1)</div>
        <Lista items={EXCEPCIONES_PLANTA} />
        <div className="h2" style={{ margin: '14px 0 0', fontSize: '0.95rem' }}>Se agregaron con el Acta Paritaria del 28/03/2022 (<Cita n="Decreto 1434/23" />)</div>
        <Lista items={EXCEPCIONES_PLANTA_2022} />
        <div className="muted" style={nota}>
          Cualquier inasistencia fuera de las previstas hace perder la bonificación del mes (<Cita n="Decreto 4204/89" /> art. 2, al que remite el 145/90 art. 3).
        </div>
      </div>

      <SimuladorPlanta />
    </>
  );
}

function TabPdf() {
  const [tema, setTema] = useState<'Todos' | Tema>('Todos');
  const lista = NORMAS.filter((n) => tema === 'Todos' || n.tema === tema);
  return (
    <div className="card" style={card}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['Todos', 'Guardia', 'Planta', 'Salarial', 'Otros'] as const).map((t) => (
          <button key={t} type="button" className="btn" onClick={() => setTema(t)}
            style={{ opacity: tema === t ? 1 : 0.55, fontWeight: tema === t ? 700 : 400 }}>{t}</button>
        ))}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
        <thead><tr><th style={th}>Norma</th><th style={th}>Vigencia</th><th style={th}>Tema</th><th style={th}>Resumen</th><th style={th}></th></tr></thead>
        <tbody>
          {lista.map((n) => (
            <tr key={n.archivo}>
              <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{n.nombre}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{n.fecha}</td>
              <td style={td}>{n.tema}</td>
              <td style={td}>{n.resumen}{n.textoActualizado && <span className="muted" style={{ fontSize: '0.74rem' }}> · texto actualizado oficial</span>}</td>
              <td style={td}><a className="btn" href={`/normativa/${n.archivo}`} target="_blank" rel="noreferrer">📄 PDF</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={nota}>
        Fuente: normas.gba.gob.ar (Sistema de Información Normativa de la Provincia), descargado el 20/10/2026. Los que dicen "texto actualizado oficial" no tienen copia escaneada en el portal.
      </div>
    </div>
  );
}

export function NormativaPage() {
  const [tab, setTab] = useState<Tab>('guardia');
  const tabs: [Tab, string][] = [['guardia', '🩺 Plus de Guardia'], ['planta', '🏥 Plus de Planta'], ['pdf', '📚 Normativa (PDF)']];
  return (
    <Layout title="Normativa">
      <div className="card" style={{ marginTop: 12, padding: 16 }}>
        <div className="h2" style={{ margin: 0 }}>⚖️ Normativa · Plus de Guardia y de Planta (Ley 10.471)</div>
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
          Interpretación de los decretos vigentes al 20/10/2026. Cada norma citada abre su PDF oficial. Lo que dice "interpretación" no está escrito tal cual en la norma.
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 12, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          {tabs.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '10px 18px', fontSize: '0.9rem',
              fontWeight: tab === k ? 700 : 400, color: tab === k ? '#e2e8f0' : '#64748b',
              borderBottom: tab === k ? '2px solid #7c3aed' : '2px solid transparent',
            }}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'guardia' && <TabGuardia />}
      {tab === 'planta' && <TabPlanta />}
      {tab === 'pdf' && <TabPdf />}
    </Layout>
  );
}

export default NormativaPage;
