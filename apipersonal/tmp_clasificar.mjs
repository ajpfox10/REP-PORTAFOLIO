import fs from 'node:fs';
const cache = JSON.parse(fs.readFileSync('tmp_textos.json', 'utf8'));
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');

// Reglas: la primera que matchea gana. `n` = texto normalizado, `f` = nombre de archivo normalizado.
const REGLAS = [
  ['CUIL',                          n => /CONSTANCIA DE CUIL|CODIGO UNICO DE IDENTIFICACION LABORAL/.test(n)],
  ['Certificado ant. Nacionales',   n => /REGISTRO NACIONAL DE REINCIDENCIA|REINCIDENCIA Y ESTADISTICA CRIMINAL/.test(n)],
  ['Certificado ant. Provinciales', n => /REGISTRO DE ANTECEDENTES/.test(n) && /POLICIA DE LA PROVINCIA|MINISTERIO DE SEGURIDAD/.test(n)],
  ['Certificado Apto Psicofisico',  n => /APTITUD PSICOFISICA|APTO PSICOFISICO|MEDICINA OCUPACIONAL/.test(n)],
  ['Libre de deuda (RDAM)',         n => /DEUDORES ALIMENTARIOS|REGISTRO DE DEUDORES/.test(n)],
  ['Certificado de aportantes (IPS)', n => /INSTITUTO DE PREVISION SOCIAL/.test(n) && /APORTANT|CERTIFICACION DE SERVICIOS|APORTES/.test(n)],
  ['Etico (si lo tuviere)',         n => /ETICA PUBLICA|DECLARACION JURADA PATRIMONIAL|PATRIMONIAL INTEGRAL/.test(n)],
  ['Planilla de incompatibilidad',  n => /INCOMPATIBILIDAD/.test(n)],
  ['DDJJ Cond. De Salud',           n => /CONDICION(ES)? DE SALUD|DECLARACION JURADA DE SALUD|ESTADO DE SALUD/.test(n)],
  ['Constancia de Aceptacion SIAPE', n => /ACEPTACION/.test(n) && /SIAPE|CARGO/.test(n)],
  ['Caratula SIAPE',                n => /CARATULA/.test(n)],
  ['Curriculum',                    n => /CURRICULUM VITAE|CURRICULUM/.test(n)],
  ['Titulo',                        n => /OTORGA EL TITULO|EXPIDE EL PRESENTE TITULO|TITULO DE |TITULO EN TRAMITE|BACHILLER|TECNICO SUPERIOR EN|DIRECCION GENERAL DE CULTURA Y EDUCACION/.test(n)],
  ['Matricula (si la tuviere)',     n => /MATRICULA (PROFESIONAL|N)|COLEGIO DE /.test(n)],
  ['Planilla de datos personales',  n => /PLANILLA DE DATOS PERSONALES|DATOS PERSONALES DEL AGENTE/.test(n)],
  ['DNI',                           n => /DOCUMENTO NACIONAL DE IDENTIDAD|REGISTRO NACIONAL DE LAS PERSONAS/.test(n)],
  ['Declaracion jurada',            n => /DECLARACION JURADA/.test(n)],
];

const dniDe = n => [...n.matchAll(/\b([12]?\d{7,8})\b/g)].map(m => m[1]);

const filas = [];
for (const [ruta, r] of Object.entries(cache)) {
  const n = norm(r.texto), f = norm(r.name);
  let destino = null;
  for (const [dest, test] of REGLAS) if (test(n) || test(f)) { destino = dest; break; }
  const dnisEnTexto = dniDe(n);
  const coincideDni = dnisEnTexto.includes(String(r.dni));
  const otroDni = !coincideDni && dnisEnTexto.length > 0;
  filas.push({ ruta, dni: r.dni, name: r.name, origen: r.origen, chars: n.length, destino, coincideDni, otroDni });
}

const porDestino = {};
for (const f of filas) porDestino[f.destino || '(sin clasificar)'] = (porDestino[f.destino || '(sin clasificar)'] || 0) + 1;
console.log('archivos analizados:', filas.length);
console.log(Object.entries(porDestino).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${String(v).padStart(4)}  ${k}`).join('\n'));
console.log('sin texto util (<40 chars):', filas.filter(f => f.chars < 40).length);
console.log('clasificados con DNI de OTRO agente:', filas.filter(f => f.destino && f.otroDni).length);
fs.writeFileSync('tmp_plan.json', JSON.stringify(filas, null, 1));
