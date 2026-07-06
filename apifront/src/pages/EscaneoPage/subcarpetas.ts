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
      'Antecedentes',
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
  { categoria: 'Antecedentes', subdivisiones: ['Nacionales', 'Provinciales'] },
  { categoria: 'Jubilación', subdivisiones: [] },
  { categoria: 'Varios', subdivisiones: [] },
];

/** Devuelve las subdivisiones preset de una categoría (o []). */
export function presetSubdivisiones(categoria: string): string[] {
  return SUBCARPETAS_PRESETS.find(p => p.categoria === categoria)?.subdivisiones ?? [];
}
