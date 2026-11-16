// src/pages/EscaneoPage/subcarpetas.ts
// Presets de subcarpetas del legajo (2 niveles: categoría → subdivisión).
// Editá libremente esta lista: el nombre es exactamente el de la carpeta en disco.
// Evitá los caracteres  /  \  |  :  *  ?  "  < >  (se sanean en el backend).

export type PresetSubcarpeta = {
  categoria: string;
  subdivisiones: string[];
};

export const SUBCARPETAS_PRESETS: PresetSubcarpeta[] = [
  {
    categoria: 'Nombramiento',
    subdivisiones: [
      'Pronunciamiento Ético',
      'Certificación de Tareas',
      'Planilla de Compatibilidad',
      'IPS',
      'Matrícula',
      'DDJJ Salud',
      'Preocupacional',
      'Datos Personales',
      'Carta de Ciudadanía',
    ],
  },
  {
    categoria: 'Licencias',
    subdivisiones: ['Médicas', 'Particulares', 'Maternidad', 'Estudio', 'Otras'],
  },
  {
    categoria: 'Títulos y Estudios',
    subdivisiones: ['Secundario', 'Universitario y Terciario', 'Certificados'],
  },
  {
    categoria: 'Salud e IOMA',
    subdivisiones: ['IOMA', 'Certificados Médicos', 'Discapacidad'],
  },
  // mismos nombres que crea docuCarpeta (orden_documentos_expediente) y usa el robot gmail_antecedentes
  { categoria: 'Certificado ant. Nacionales', subdivisiones: [] },
  { categoria: 'Certificado ant. Provinciales', subdivisiones: [] },
  { categoria: 'Jubilación', subdivisiones: [] },
  { categoria: 'Varios', subdivisiones: [] },
];

/** Carpeta del legajo que se preselecciona al elegir el tipo de documento. */
export const CARPETA_POR_TIPO: Record<string, string> = {
  antecedentes_nacionales: 'Certificado ant. Nacionales',
  antecedentes_provinciales: 'Certificado ant. Provinciales',
  // carpeta de DOCU que lee el robot pase_planta (si queda en la raíz no la copia)
  planilla_compatibilidad: 'Planilla de incompatibilidad',
};

/** Devuelve las subdivisiones preset de una categoría (o []). */
export function presetSubdivisiones(categoria: string): string[] {
  return SUBCARPETAS_PRESETS.find(p => p.categoria === categoria)?.subdivisiones ?? [];
}
