export type TipoDocumentoEscaneo = {
  value: string;
  label: string;
  icon: string;
  group?: string;
};

export const GROUP_LABELS: Record<string, string> = {
  nombramiento: '📋 Nombramiento',
};

export const TIPOS_DOCUMENTO: TipoDocumentoEscaneo[] = [
  // ── General ──────────────────────────────────────────────────────────────
  { value: 'dni_frente',           label: 'DNI - Frente',                     icon: '🪪' },
  { value: 'dni_dorso',            label: 'DNI - Dorso',                      icon: '🪪' },
  { value: 'titulo_secundario',    label: 'Título Secundario',                icon: '🎓' },
  { value: 'titulo_universitario', label: 'Título Universitario / Terciario', icon: '🎓' },
  { value: 'licencia_conducir',    label: 'Licencia de Conducir',             icon: '🚗' },
  { value: 'acta_nacimiento',      label: 'Acta de Nacimiento',               icon: '👶' },
  { value: 'partida_matrimonio',   label: 'Partida de Matrimonio',            icon: '💍' },
  { value: 'partida_nacimiento',   label: 'Partida de Nacimiento',            icon: '📜' },
  { value: 'dni_hijos',            label: 'DNI Hijos',                        icon: '🪪' },
  { value: 'dni_conyuge',          label: 'DNI Cónyuge',                      icon: '🪪' },
  { value: 'cert_discapacidad',    label: 'Certificado de Discapacidad',      icon: '♿' },
  { value: 'dj_asignacion',        label: 'Decl. Jurada de Asignación',       icon: '📋' },
  { value: 'guarderia',            label: 'Guardería',                        icon: '🧸' },
  { value: 'cedula_notificacion',  label: 'Cédula de Notificación',           icon: '📨' },
  { value: 'contrato_trabajo',     label: 'Contrato de Trabajo',              icon: '💼' },
  { value: 'certificado_medico',   label: 'Certificado Médico',               icon: '🏥' },
  { value: 'certificado_estudio',  label: 'Certificado de Estudios',          icon: '📚' },
  { value: 'certificado_escolar',  label: 'Certificado Escolar',              icon: '🎒' },
  { value: 'recibo_sueldo',        label: 'Recibo de Sueldo',                 icon: '💵' },
  { value: 'declaracion_jurada',   label: 'Declaración Jurada',               icon: '✍️' },
  { value: 'resolucion',           label: 'Resolución',                       icon: '⚖️' },
  { value: 'nota_pedido',          label: 'Nota / Pedido',                    icon: '📝' },
  { value: 'jubilacion',           label: 'Documentación Jubilación',         icon: '🧓' },
  { value: 'ioma',                 label: 'Documentación IOMA',               icon: '🏥' },
  { value: 'foto_carnet',          label: 'Foto Carnet',                      icon: '📷' },
  { value: 'segunda_foto',         label: 'Segunda Foto',                     icon: '📷' },
  { value: 'cert_rotacion',        label: 'Certificación de rotación',        icon: '🔄' },
  { value: 'dictamen_junta',       label: 'Dictamen Junta Médica',            icon: '🩺' },
  { value: 'legajo',               label: 'Legajo',                           icon: '📁' },
  { value: 'nota_cambio_agrupamiento', label: 'Nota Solicitud Cambio de Agrupamiento', icon: '📝' },
  { value: 'otro',                 label: 'Otro documento',                   icon: '📄' },

  // ── Nombramiento ─────────────────────────────────────────────────────────
  { value: 'pronunciamiento_etico',       label: 'Pronunciamiento Ético',                    icon: '⚖️', group: 'nombramiento' },
  { value: 'cert_tareas',                 label: 'Certificación de Tareas',                  icon: '📋', group: 'nombramiento' },
  { value: 'planilla_compatibilidad',     label: 'Planilla de Compatibilidad',               icon: '📊', group: 'nombramiento' },
  { value: 'cert_ips_beneficio',          label: 'Certificado IPS Beneficio',                icon: '🏛️', group: 'nombramiento' },
  { value: 'cert_ips_aportes',            label: 'Certificado IPS Aportes',                  icon: '🏛️', group: 'nombramiento' },
  { value: 'antecedentes_nacionales',     label: 'Antecedentes Nacionales',                  icon: '🔍', group: 'nombramiento' },
  { value: 'antecedentes_provinciales',   label: 'Antecedentes Provinciales',                icon: '🔍', group: 'nombramiento' },
  { value: 'matricula',                   label: 'Matrícula',                                icon: '🎖️', group: 'nombramiento' },
  { value: 'dj_condiciones_salud',        label: 'Decl. Jurada de Condiciones de Salud',     icon: '🩺', group: 'nombramiento' },
  { value: 'declaracion_jurada',          label: 'Declaración Jurada',                       icon: '✍️', group: 'nombramiento' },
  { value: 'preocupacional',              label: 'Preocupacional',                           icon: '🏥', group: 'nombramiento' },
  { value: 'planilla_datos_personales',   label: 'Planilla de Datos Personales y de Contacto', icon: '📇', group: 'nombramiento' },
  { value: 'carta_ciudadania',            label: 'Carta de Ciudadanía',                      icon: '🛂', group: 'nombramiento' },
  { value: 'dni_hijos',                   label: 'DNI Hijos',                                icon: '🪪', group: 'nombramiento' },
  { value: 'dni_conyuge',                 label: 'DNI Cónyuge',                              icon: '🪪', group: 'nombramiento' },
  { value: 'solicitud_btu',               label: 'Solicitud de BTU',                         icon: '🧾', group: 'nombramiento' },
];
