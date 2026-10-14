-- 077__revertir_mapeos_076.sql
-- El usuario une él las novedades (13/10/2026): se desactivan las uniones que cargó
-- la 076 y se vuelve a "solo equivalencia" en VV y 312 (la 076 les había prendido la carga).
-- Las de la 074 quedan (el usuario pidió revertir solo las últimas).
-- observacion deja de ser 'inicial:' para que "Restaurar default" no las vuelva a prender.

UPDATE mapeo_novedades
   SET activo = 0, usar_para_cargar = 0,
       observacion = '077: desactivada (la une el usuario) - era 076 catalogo SiAPe'
 WHERE observacion = 'inicial: 076 catalogo SiAPe';

UPDATE mapeo_novedades SET usar_para_cargar = 0
 WHERE codigo_cie = '' AND activo = 1
   AND ((novedad_siape = 'PARA MUJERES VICTIMAS DE VIOLENCIA' AND novedad_ministerio = 'VV-MUJER VICTIMA DE VIOLENCIA DE GENERO')
     OR (novedad_siape = 'NACIMIENTO CORRESPONSABLE PARENTAL MULTIPLE' AND novedad_ministerio = '312-PATERNIDAD/CORRESPONSAL PARENTAL NACIMIENTO MULTIPLE'));
