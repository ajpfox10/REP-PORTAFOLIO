-- 110: robot que cambia en la Intranet la E (pendiente de justificación) por el código real
-- cuando SIAPE ya otorgó la licencia (05/11/2026). Sin programar: se programa desde la página Robots.
INSERT INTO robots_config (script, descripcion, grupo, orden, comando, reporta_solo, prog_activa, prog_dias,
                           destino_nombre, destino_editable, notas, activo)
SELECT 'intranet_corregir_licencias_e', 'Corregir E de licencias otorgadas', 'Asistencia 2.0', 29,
       'python corregir_licencias_e_intranet.py --confirmar', 1, 0, '',
       'Intranet + logs/licencias_e_corregidas.csv', 0,
       'Licencias médicas cargadas en el Ministerio como E (pendiente de justificación) que en LICENCIAS_MEDICAS.xlsx ya figuran OTORGADA/APROBADA: borra la E y carga el código del mapeo (01 / 05 / 1R* por CIE). PENDIENTE, DENEGADA y demás quedan con E. Si la carga nueva falla, repone la E. Desde 01/10/2026. Correr después de bajar LICENCIAS_MEDICAS.xlsx y la descarga anual del Ministerio.',
       1
 WHERE NOT EXISTS (SELECT 1 FROM robots_config WHERE script = 'intranet_corregir_licencias_e');
