"""
Da de baja en SiAPe a los agentes que se dieron de baja en la base.

Flujo (definido con el usuario, 05/10/2026; mapa en siape_mapping_baja.md):
  menu Cargos -> "Cargos y Carrera Administrativa" -> buscar agente -> BUSCAR
  -> doble click en el cargo actual (amarillo) -> "Ingresar como Supervisor"
  -> pestaña BAJA -> FECHA DE BAJA + MOTIVO preventivo -> Guardar
  -> MOTIVO definitivo -> Guardar   (misma corrida; sin ACTO DE BAJA)

  Motivo preventivo: BAJA BECA si es becado/residente, PLANTELES BASICOS el resto.
  Motivo definitivo: agentes.motivo_baja; residente sin motivo -> FIN DESIGNACION.

Alcance: residentes dados de baja desde el ciclo 2026 (residencias_bajas) y cualquier
baja real (DNI sin tramo ACTIVO/COMISION/TRAMITE/INACTIVO) con egreso >= BAJAS_SIAPE_DESDE.
Los tramos BAJA de carrera (el agente sigue activo) NO entran.

Tabla (se crea sola): baja_carga_siape, una fila por tramo dado de baja.
  estado PENDIENTE / PREVENTIVA (1er guardado ok, falta el 2do) / OK / ERROR / SIN_MOTIVO
         EXCLUIDO = sacada a mano de la cola (el robot no la toca ni la regenera)

Uso:
  python cargar_bajas_siape.py --dry-run                      # arma y muestra la cola
  python cargar_bajas_siape.py --dni xxxxxxx --hasta buscar  # prueba hasta un paso
  python cargar_bajas_siape.py --dni xxxxxxx                 # carga ese agente
Pasos de --hasta: menu, buscar, cargo, supervisor, pestana, preventiva-sin-guardar, preventiva, todo
"""

import argparse
import os
import sys
import time
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + .env + script_run_items

SCRIPT_ID = "siape_carga_bajas"
TABLA = "baja_carga_siape"
FRAME_CARGOS = "Cargos y Carrera Administrativa"
DESDE = os.environ.get("BAJAS_SIAPE_DESDE", "2026-10-05")
CICLO_RESIDENTES = int(os.environ.get("BAJAS_SIAPE_CICLO_RESIDENTES", "2026") or "2026")
MAX_INTENTOS_AUTO = 3

MOTIVO_BECA = "BAJA BECA"
MOTIVO_PLANTA = "PLANTELES BASICOS"
MOTIVO_FIN_RESIDENCIA = "FIN DESIGNACION"   # lista de becarios (no tiene "FIN DESIGNACION PERMANENTE")
# becados / residentes: planta BECA, leyes de programas de beca, RESIDENTES, PRE-RESIDENTES
LEYES_BECA = (6, 7, 8, 9, 10, 11, 12, 13, 18)
PLANTA_BECA = 5
OCUPACION_RESIDENTE = 132

MOTIVOS_SIAPE = (
    "ABANDONO DE CARGO", "BAJA BECA", "CESANTE", "CESE EN LA FUNCION SIN ESTABILIDAD",
    "EXONERACION", "FALLECIMIENTO", "FIN DESIGNACION PERMANENTE", "FUNCION LIMITADA",
    "FUNCION LIMITADA POR CESE", "FUNCION LIMITADA POR RENUNCIA", "INCAPACIDAD LABORAL",
    "JUBILACION", "LIMITACION REGIMEN MODULAR", "MODIFICACION PRESUPUESTARIA",
    "NUEVA ESTRUCTURA", "PLANTELES BASICOS", "PRESCINDIBILIDAD", "RECATEGORIZACION",
    "RECONOCIMIENTO DE SERVICIOS", "REG.HORARIO 40", "REG.HORARIO 48", "REINTEGRO",
    "RENUNCIA AL CARGO", "RETIRO ABSOLUTO", "RETIRO OBLIGATORIO", "RETIRO VOLUNTARIO",
    "REUBICACION", "TRASLADO (A OTRA JURISDICCION)", "TRASLADO INTERNO",
)

PASOS = ("menu", "buscar", "cargo", "supervisor", "pestana", "preventiva-sin-guardar", "preventiva", "todo")


# ── tablas ────────────────────────────────────────────────────────────────────

def crear_tablas(cur):
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS {TABLA} (
          id INT NOT NULL AUTO_INCREMENT,
          agente_id INT NOT NULL COMMENT 'tramo de agentes que se cerro en BAJA',
          dni INT NOT NULL,
          fecha_baja DATE NOT NULL,
          origen VARCHAR(20) NOT NULL COMMENT 'RESIDENTE / GENERAL',
          motivo_preventivo VARCHAR(60) NOT NULL,
          motivo_definitivo VARCHAR(60) NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
            COMMENT 'PENDIENTE / PREVENTIVA / OK / ERROR / SIN_MOTIVO',
          detalle VARCHAR(500) NULL,
          intentos INT NOT NULL DEFAULT 0,
          preventiva_en DATETIME NULL,
          cargado_en DATETIME NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_baja_carga_siape__agente (agente_id),
          KEY idx_baja_carga_siape__dni (dni),
          KEY idx_baja_carga_siape__estado (estado),
          CONSTRAINT fk_baja_carga_siape__agente FOREIGN KEY (agente_id)
            REFERENCES agentes (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""")
    cur.execute("""SELECT COUNT(*) AS n FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND table_name = 'agentes'
                      AND column_name = 'motivo_baja'""")
    if not cur.fetchone()["n"]:
        cur.execute("""ALTER TABLE agentes ADD COLUMN motivo_baja VARCHAR(60) NULL
                       COMMENT 'motivo de baja tal cual figura en SIAPE' AFTER fecha_egreso""")


def generar(cn):
    """Agrega a la cola las bajas nuevas y completa el motivo definitivo si ya llego."""
    with cn.cursor() as cur:
        crear_tablas(cur)
        cur.execute(f"""
            SELECT a.id, a.dni, a.fecha_egreso, a.motivo_baja,
                   (a.ley_id IN %s OR a.planta_id = %s OR a.ocupacion_id = %s) AS es_beca,
                   EXISTS (SELECT 1 FROM residencias_bajas rb
                            WHERE rb.dni = a.dni AND rb.ciclo >= %s AND rb.estado = 'BAJA'
                              AND rb.fecha_baja = a.fecha_egreso) AS es_residente
              FROM agentes a
             WHERE a.deleted_at IS NULL AND a.estado_empleo = 'BAJA' AND a.fecha_egreso IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM agentes b
                                WHERE b.dni = a.dni AND b.deleted_at IS NULL
                                  AND b.estado_empleo IN ('ACTIVO','COMISION','TRAMITE','INACTIVO'))
               AND a.id = (SELECT MAX(c.id) FROM agentes c
                            WHERE c.dni = a.dni AND c.deleted_at IS NULL AND c.estado_empleo = 'BAJA')""",
                    (LEYES_BECA, PLANTA_BECA, OCUPACION_RESIDENTE, CICLO_RESIDENTES))
        nuevos = 0
        for r in cur.fetchall():
            residente = bool(r["es_residente"])
            if not residente and r["fecha_egreso"] < date.fromisoformat(DESDE):
                continue
            preventivo = MOTIVO_BECA if (r["es_beca"] or residente) else MOTIVO_PLANTA
            definitivo = r["motivo_baja"] or (MOTIVO_FIN_RESIDENCIA if residente else None)
            cur.execute(f"""
                INSERT INTO {TABLA} (agente_id, dni, fecha_baja, origen, motivo_preventivo,
                                     motivo_definitivo, estado)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  fecha_baja = IF(estado IN ('PENDIENTE','SIN_MOTIVO','ERROR'), VALUES(fecha_baja), fecha_baja),
                  motivo_definitivo = COALESCE(VALUES(motivo_definitivo), motivo_definitivo),
                  estado = IF(estado = 'SIN_MOTIVO' AND VALUES(motivo_definitivo) IS NOT NULL,
                              'PENDIENTE', estado)""",
                        (r["id"], r["dni"], r["fecha_egreso"], "RESIDENTE" if residente else "GENERAL",
                         preventivo, definitivo, "PENDIENTE" if definitivo else "SIN_MOTIVO"))
            nuevos += 1 if cur.rowcount == 1 else 0
    cn.commit()
    return nuevos


def traer_cola(cn, dni=None, limit=None):
    sql = f"""
        SELECT c.*, a.legajo, p.cuil,
               TRIM(CONCAT(COALESCE(p.apellido,''), ' ', COALESCE(p.nombre,''))) AS nombre
          FROM {TABLA} c
          JOIN agentes a ON a.id = c.agente_id
          LEFT JOIN personal p ON p.dni = c.dni
         WHERE (c.estado IN ('PENDIENTE','PREVENTIVA') OR (c.estado = 'ERROR' AND c.intentos < %s))"""
    params = [MAX_INTENTOS_AUTO]
    if dni:
        sql = sql.replace("WHERE (", "WHERE c.dni = %s AND (", 1)
        params.insert(0, dni)
    sql += " ORDER BY c.fecha_baja, c.id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with cn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def marcar(cn, fila_id, estado, detalle=None):
    with cn.cursor() as cur:
        cur.execute(
            f"""UPDATE {TABLA} SET estado=%s, detalle=%s, intentos=intentos+1,
                       preventiva_en=IF(%s IN ('PREVENTIVA','OK') AND preventiva_en IS NULL, NOW(), preventiva_en),
                       cargado_en=IF(%s='OK', NOW(), cargado_en)
                 WHERE id=%s""",
            (estado, (detalle or None) and str(detalle)[:500], estado, estado, fila_id))
    cn.commit()


# ── SiAPe ─────────────────────────────────────────────────────────────────────

class Parada(Exception):
    """Se llego al paso pedido con --hasta: la pantalla queda como esta."""


def _parar_si(paso, hasta):
    if hasta and PASOS.index(hasta) <= PASOS.index(paso) and hasta != "todo":
        raise Parada(paso)


def _frame_cargos(F, timeout):
    """True si esta abierta 'Cargos y Carrera Administrativa'.

    No se busca el internal frame por nombre: trae decenas de espacios al final y
    recorrer el arbol hasta el es lento (la grilla de CARGOS son cientos de celdas,
    el walk se corta por tiempo). Se usa el boton 'Ingresar como Supervisor' de la
    cabecera, que es propio de esta pantalla y se encuentra en segundos."""
    _, info = F._jab_buscar(nombre="Ingresar como Supervisor", role="push button",
                            timeout=timeout, y_min=100, y_max=160)
    return info is not None


def abrir_cargos(F):
    """Deja abierto el frame 'Cargos y Carrera Administrativa'."""
    F.cerrar_modales()
    if _frame_cargos(F, timeout=15):
        return
    _, menu = F._jab_buscar(empieza="Cargos", role="menu", timeout=20, y_max=40)
    if not menu:
        raise RuntimeError("No encuentro el menu 'Cargos' de SiAPe.")
    F._jab_click_bounds(menu)
    time.sleep(F.PAUSA_MEDIA)
    # Con el menu desplegado los items ya tienen bounds: se elige por nombre.
    # Cargos -> "Administración nemotécnico A" abre "Cargos y Carrera Administrativa"
    # (visto en vivo 05/10/2026; el menu no tiene ningun item que diga "Carrera").
    item = None
    vistos = []
    for _el, _d, info in F._jab_walk(max_depth=30, max_segundos=25):
        if info.get("role") != "menu item" or not F._bounds_ok(info):
            continue
        nombre = (info.get("name") or "").strip()
        vistos.append(nombre)
        if nombre.lower().startswith("administraci"):
            item = info
            break
    if not item:
        import pyautogui
        pyautogui.press("escape")
        raise RuntimeError(f"Abri el menu Cargos pero no veo 'Administración'. Items: {vistos[:30]}")
    F.log(f"   menu: {item.get('name')}")
    F._jab_click_bounds(item)
    if not _frame_cargos(F, timeout=40):
        raise RuntimeError(f"Clickee '{item.get('name')}' pero no se abrio '{FRAME_CARGOS}'.")


def _texto_campo(F, **kw):
    el, _info = F._jab_buscar(role="text", timeout=10, **kw)
    return F._jab_read_text(el).strip() if el else ""


def _volcar_arbol(F, root, archivo):
    """Deja el arbol JAB de una ventana en siape_map_baja/ (para mapear lo nuevo)."""
    try:
        from pathlib import Path
        out = Path(__file__).resolve().parent / "siape_map_baja"
        out.mkdir(exist_ok=True)
        lineas = []
        for el, d, info in F._jab_walk(max_depth=20, root=root, max_segundos=20):
            if not F._bounds_ok(info):
                continue
            b = info.get("bounds") or {}
            txt = F._jab_read_text(el).strip() if info.get("role") in ("text", "label") else ""
            lineas.append(f"{'  ' * d}{info.get('role')} | {(info.get('name') or '').strip()} | "
                          f"{info.get('description') or ''} | ({b.get('x')},{b.get('y')},{b.get('width')},"
                          f"{b.get('height')}) | {','.join(info.get('states') or [])}"
                          + (f" | txt={txt!r}" if txt else ""))
        (out / archivo).write_text("\n".join(lineas), encoding="utf-8")
    except Exception as e:
        F.log(f"AVISO: no pude volcar el arbol a {archivo}: {e}")


def _dentro(info, caja):
    b = info.get("bounds") or {}
    c = caja.get("bounds") or {}
    return (c.get("x", 0) <= b.get("x", -1) <= c.get("x", 0) + c.get("width", 0)
            and c.get("y", 0) <= b.get("y", -1) <= c.get("y", 0) + c.get("height", 0))


def buscar_agente(F, fila):
    """BUSCAR de la cabecera -> 'Buscador de Personas' -> por Documento (DNI) -> ACEPTAR.

    Visto en vivo 05/10/2026: BUSCAR abre el internal frame 'Buscador de Personas'
    con radios 'Apellido y Nombre' / 'Documento', campos de documento (tipo, '...',
    numero), BUSCAR, grilla APELLIDO Y NOMBRE | LEGAJO | TIPO | NRO. DOCUMENTO |
    CUIT - CUIL | ROL | ORGANISMO y ACEPTAR. Se busca por DNI (no por legajo, que en
    la base no es confiable para SiAPe). Al volver se verifica el DNI de la cabecera."""
    F.cerrar_modales()
    dni = str(fila["dni"])
    _, buscar = F._jab_buscar(nombre="BUSCAR", role="push button", timeout=20, y_min=100, y_max=160)
    if not buscar:
        raise RuntimeError("No encuentro BUSCAR en la cabecera de Cargos.")
    F._jab_click_bounds(buscar)
    time.sleep(F.PAUSA_LARGA)

    frame_el, frame = F._jab_buscar(empieza="Buscador de Personas", role="internal frame", timeout=25)
    if not frame:
        texto, _ = F.leer_dialogo_jab(max_segundos=6)
        raise RuntimeError("BUSCAR no abrio el 'Buscador de Personas'"
                           + (f" (aviso: {' '.join(texto.split())[:150]})" if texto else ""))
    _volcar_arbol(F, frame_el, "buscador_personas.txt")

    controles = [info for _el, _d, info in F._jab_walk(max_depth=20, root=frame_el, max_segundos=20)
                 if F._bounds_ok(info)]
    radio_doc = next((c for c in controles if c.get("role") == "radio button"
                      and "documento" in (c.get("name") or "").lower()), None)
    if not radio_doc:
        raise RuntimeError("No encuentro la opcion 'Documento' del Buscador de Personas.")
    F._jab_click_bounds(radio_doc)
    time.sleep(F.PAUSA_CORTA)

    # Campo del numero: el text editable mas a la derecha en la fila del radio Documento
    ry = radio_doc["bounds"]["y"]
    fila_doc = [c for c in controles if c.get("role") == "text"
                and abs(c["bounds"]["y"] - ry) <= 15 and c["bounds"]["x"] > radio_doc["bounds"]["x"]]
    if not fila_doc:
        raise RuntimeError("No encuentro el campo del numero de documento en el Buscador.")
    nro = max(fila_doc, key=lambda c: c["bounds"]["x"])
    F._jab_set_text_by_bounds(nro, dni)

    btn = next((c for c in controles if c.get("role") == "push button"
                and (c.get("name") or "").strip().upper() == "BUSCAR"), None)
    if not btn:
        raise RuntimeError("No encuentro el BUSCAR del Buscador de Personas.")
    F._jab_click_bounds(btn)
    time.sleep(F.PAUSA_LARGA)
    texto, _ = F.leer_dialogo_jab(max_segundos=6)
    if texto:
        F.cerrar_modales()
        raise RuntimeError(f"SiAPe aviso en el Buscador: {' '.join(texto.split())[:200]}")

    # Primera fila de resultados: la celda de texto mas arriba debajo de los encabezados.
    # 07/10: el Buscador SI traia el resultado (quedo en el volcado) pero este recorrido volvia
    # vacio -> el frame_el de antes de BUSCAR queda viejo / el walk se corta por tiempo. Se
    # re-ubica el frame tras BUSCAR, con mas tiempo, y se reintenta antes de dar error.
    celdas = []
    for intento in range(3):
        fe, _fi = F._jab_buscar(empieza="Buscador de Personas", role="internal frame", timeout=15)
        raiz = fe or frame_el
        for el, _d, info in F._jab_walk(max_depth=20, root=raiz, max_segundos=45):
            if info.get("role") == "text" and F._bounds_ok(info) and info["bounds"]["y"] > ry + 40:
                celdas.append((info["bounds"]["y"], info["bounds"]["x"], el, info))
        if celdas:
            break
        F.log(f"   Buscador: grilla sin leer (intento {intento + 1}/3), reintento...")
        time.sleep(F.PAUSA_LARGA)
    if not celdas:
        _volcar_arbol(F, frame_el, "buscador_sin_resultado.txt")
        raise RuntimeError("El Buscador no devolvio resultados para el DNI.")
    y0 = min(c[0] for c in celdas)
    primera = sorted([c for c in celdas if abs(c[0] - y0) <= 3], key=lambda c: c[1])
    textos = [F._jab_read_text(c[2]).strip() for c in primera]
    F.log(f"   Buscador fila 1: {' | '.join(textos)}")
    if not any(dni in t.replace(".", "").replace("-", "") for t in textos):
        raise RuntimeError(f"La primera fila del Buscador no es el DNI {dni}: {textos}. Freno.")
    F._jab_click_bounds(primera[0][3])
    aceptar = next((c for c in controles if c.get("role") == "push button"
                    and (c.get("name") or "").strip().upper() == "ACEPTAR"), None)
    if not aceptar:
        raise RuntimeError("No encuentro ACEPTAR en el Buscador de Personas.")
    F._jab_click_bounds(aceptar)
    time.sleep(F.PAUSA_LARGA)
    texto, _ = F.leer_dialogo_jab(max_segundos=6)
    if texto:
        F.cerrar_modales()
        raise RuntimeError(f"SiAPe aviso al aceptar: {' '.join(texto.split())[:200]}")
    doc = _texto_campo(F, nombre="", x_min=560, x_max=600, y_min=100, y_max=160)
    nombre = _texto_campo(F, nombre="APELLIDO y NOMBRE", y_min=100, y_max=160)
    F.log(f"   SiAPe muestra: {nombre} DNI {doc}")
    if doc.replace(".", "") != dni:
        # Abrir a otra persona y darle de baja seria mucho peor que no hacer nada.
        raise RuntimeError(f"Busque el DNI {dni} y SiAPe muestra '{nombre}' DNI '{doc}', no {dni}. Freno.")


def elegir_cargo_actual(F):
    """Doble click en el cargo actual (fila amarilla) de la pestaña CARGOS.

    JAB no expone el color: el cargo actual es la fila con DESDE cargado y HASTA
    vacio (visto en vivo: amarillo = 01/11/2025 -> sin hasta). Cada celda trae la
    columna en `description` (LEY, DESDE, HASTA, ACTO...). Si hay 0 o mas de 1
    candidata, se frena.

    Se recorre con el walker del observador (solo nodos visibles, ~5s): el
    F._jab_walk con banda_y descarta la grilla entera porque un contenedor
    intermedio informa bounds fuera de pantalla."""
    import re
    from siape_observador_jab import recorrer
    fecha = re.compile(r"^\d{2}/\d{2}/\d{4}$")
    drv = F._jab_driver()
    filas = {}
    for n in recorrer(drv.root_element, max_seg=40):
        b = n.get("bounds") or {}
        if n.get("role") == "text" and 235 <= (b.get("y") or 0) <= 525:
            filas.setdefault(b["y"], []).append(n)
    candidatas = []
    for y, celdas in sorted(filas.items()):
        celdas.sort(key=lambda c: c["bounds"]["x"])
        col = {(c.get("description") or "").strip(): (c.get("text") or "").strip() for c in celdas}
        if fecha.match(col.get("DESDE", "")) and "HASTA" in col and col["HASTA"] == "":
            candidatas.append((y, col["DESDE"], celdas))
    if len(candidatas) != 1:
        raise RuntimeError(f"Esperaba 1 cargo actual (DESDE sin HASTA) y encontre {len(candidatas)}: "
                           f"{[c[1] for c in candidatas]}. Freno.")
    y, desde, celdas = candidatas[0]
    F.log(f"   cargo actual: desde {desde}")
    F._doble_click_bounds(celdas[0])        # la celda de color (la de mas a la izquierda)
    time.sleep(F.PAUSA_LARGA)
    texto, _ = F.leer_dialogo_jab(max_segundos=6)
    if texto:
        F.cerrar_modales()
        raise RuntimeError(f"El doble click en el cargo abrio un aviso: {' '.join(texto.split())[:200]}")


# Las pantallas de Cargos son lentas para F._jab_buscar (recorre nodos ocultos y se
# corta por tiempo). El walker del observador baja solo por lo visible (~5s) y trae
# texto e items de listas. Ojo: el `name` de un campo enfocado viene ensuciado
# (" BAJA tab page FECHA DE BAJA"): se busca por `description`, que no cambia.

def _nodos(F, max_seg=30):
    from siape_observador_jab import recorrer
    return recorrer(F._jab_driver().root_element, max_seg=max_seg)


def _nodo(nodos, role, desc=None, nombre=None, y=None, x=None):
    for n in nodos:
        if n.get("role") != role:
            continue
        if desc is not None and (n.get("description") or "").strip() != desc:
            continue
        if nombre is not None and (n.get("name") or "").strip() != nombre:
            continue
        b = n.get("bounds") or {}
        if y is not None and not (y[0] <= (b.get("y") or -1) <= y[1]):
            continue
        if x is not None and not (x[0] <= (b.get("x") or -1) <= x[1]):
            continue
        return n
    return None


def _esperar(F, cond, timeout=30, que="la pantalla"):
    """Repite el walker hasta que cond(nodos) devuelva algo."""
    limite = time.time() + timeout
    while True:
        nodos = _nodos(F)
        r = cond(nodos)
        if r:
            return r, nodos
        if time.time() > limite:
            raise RuntimeError(f"No aparecio {que}.")
        time.sleep(1)


def ingresar_supervisor(F):
    """Boton azul 'SE' al lado de BUSCAR. Sin esto la pestaña BAJA responde
    "No puede escribir". Va con click REAL de mouse: la accion JAB (el.click())
    Java la acepta sin error pero Forms la ignora (probado 05/10/2026, el usuario
    confirmo que no se apreto). Que el click no caiga en otra ventana lo asegura
    siape_encima()."""
    F.cerrar_modales()
    _el, btn = F._jab_buscar(nombre="Ingresar como Supervisor", role="push button", timeout=20,
                             y_min=100, y_max=160)
    if not btn:
        raise RuntimeError("No encuentro el boton 'Ingresar como Supervisor'.")
    # El click justo despues del doble click en el cargo a veces no toma (visto
    # 06/10/2026: mismo click, un rato despues, si). Es un interruptor: se verifica
    # que FECHA DE BAJA quede editable ANTES de volver a clickear.
    for intento in range(1, 4):
        time.sleep(F.PAUSA_LARGA)
        F._jab_click_bounds(btn)
        F.log(f"   Supervisor: click {intento} en {F._jab_bounds_center(btn)}")
        time.sleep(F.PAUSA_LARGA)
        campo = _nodo(_nodos(F), "text", desc="FECHA DE BAJA")
        if campo and "editable" in (campo.get("states") or []):
            break
    else:
        raise RuntimeError("Clickee 'Ingresar como Supervisor' 3 veces y FECHA DE BAJA sigue sin ser editable.")
    texto, _ = F.leer_dialogo_jab(max_segundos=6)
    if texto:
        # Todavia no se vio que dialogo abre: no se contesta a ciegas.
        raise RuntimeError(f"'Ingresar como Supervisor' abrio un aviso: {' '.join(texto.split())[:200]}")


def abrir_pestana_baja(F):
    """Deja la pestaña BAJA al frente (el doble click en el cargo ya suele dejarla)."""
    nodos = _nodos(F)
    tab = _nodo(nodos, "page tab", nombre="BAJA", y=(160, 200))
    if not tab:
        raise RuntimeError("No encuentro la pestaña BAJA.")
    if "seleccionado" not in (tab.get("states") or []):
        F._jab_click_bounds(tab)
        time.sleep(F.PAUSA_MEDIA)
    _esperar(F, lambda ns: _nodo(ns, "text", desc="FECHA DE BAJA"), timeout=20,
             que="el campo FECHA DE BAJA")


def poner_fecha(F, fecha):
    valor = fecha.strftime("%d/%m/%Y")
    campo = _nodo(_nodos(F), "text", desc="FECHA DE BAJA")
    if not campo:
        raise RuntimeError("No encuentro FECHA DE BAJA.")
    if "editable" not in (campo.get("states") or []):
        raise RuntimeError("FECHA DE BAJA no es editable (¿no entro como Supervisor?). Freno sin escribir.")
    F._jab_set_text_by_bounds(campo, valor)
    quedo = (_nodo(_nodos(F), "text", desc="FECHA DE BAJA") or {}).get("text", "").strip()
    if quedo != valor:
        raise RuntimeError(f"FECHA DE BAJA quedo en '{quedo}', no {valor}.")


def _motivo_actual(F, nodos=None):
    return ((_nodo(nodos or _nodos(F), "text", desc="MOTIVO DE BAJA") or {}).get("text") or "").strip()


def elegir_motivo(F, motivo):
    """Abre la LOV de motivos, filtra por %motivo%, elige la fila y acepta. Verifica el campo."""
    import pyautogui
    nodos = _nodos(F)
    if _motivo_actual(F, nodos) == motivo:
        return
    btn = _nodo(nodos, "push button", nombre="...", y=(350, 375))
    if not btn:
        raise RuntimeError("No encuentro el boton '...' de MOTIVO DE BAJA.")
    F._jab_click_bounds(btn)
    _, nodos = _esperar(F, lambda ns: _nodo(ns, "internal frame", nombre="Motivos de Baja"),
                        timeout=20, que="la lista 'Motivos de Baja'")
    buscar = _nodo(nodos, "text", desc="Buscar")
    if not buscar:
        raise RuntimeError("No encuentro el campo Buscar de la lista de motivos.")
    F._jab_set_text_by_bounds(buscar, f"%{motivo}%")
    btn_buscar = _nodo(nodos, "push button", nombre="Buscar ALT B")
    if btn_buscar:
        F._jab_click_bounds(btn_buscar)
        time.sleep(F.PAUSA_LARGA)
    nodos = _nodos(F)
    # Si el filtro deja UNA sola fila, SiAPe la elige y cierra la lista solo
    # (visto 06/10/2026 con %BAJA BECA%).
    if not _nodo(nodos, "internal frame", nombre="Motivos de Baja"):
        quedo = _motivo_actual(F, nodos)
        if quedo != motivo:
            raise RuntimeError(f"La lista se cerro sola y MOTIVO DE BAJA quedo en '{quedo}', no '{motivo}'.")
        return
    lista = next((n for n in nodos if n.get("role") == "list" and n.get("items") is not None), None)
    items = (lista or {}).get("items") or []
    exactos = [i for i, n in enumerate(items) if n.split("	")[0].split(":", 1)[-1].strip() == motivo]
    if not exactos:
        cancelar = _nodo(nodos, "push button", nombre="Cancelar ALT C")
        if cancelar:
            F._jab_click_bounds(cancelar)
        raise RuntimeError(f"La lista de motivos no tiene '{motivo}' (vi: {items[:5]}).")
    b = lista["bounds"]
    alto_fila = 18
    fila_y = b["y"] + alto_fila * exactos[0] + alto_fila // 2
    if fila_y > b["y"] + b["height"]:
        raise RuntimeError(f"'{motivo}' quedo fuera de la parte visible de la lista.")
    F._jab_click_bounds({"bounds": {"x": b["x"], "y": fila_y - 1, "width": min(b["width"], 300), "height": 2}})
    aceptar = _nodo(nodos, "push button", nombre="Aceptar ALT A")
    if aceptar:
        F._jab_click_bounds(aceptar)
    else:
        pyautogui.hotkey("alt", "a")
    time.sleep(F.PAUSA_MEDIA)
    quedo = _motivo_actual(F)
    if quedo != motivo:
        raise RuntimeError(f"MOTIVO DE BAJA quedo en '{quedo}', no '{motivo}'.")


def guardar(F, cual):
    """Guardar + encadenar avisos. Devuelve el texto de confirmacion o tira error."""
    _, btn = F._jab_buscar(nombre="Guardar", role="push button", timeout=15, y_max=80)
    if not btn:
        raise RuntimeError("No encuentro el boton Guardar.")
    F._jab_click_bounds(btn)
    time.sleep(F.PAUSA_LARGA)
    vistos = []
    for _ in range(6):
        texto, _ = F.leer_dialogo_jab(max_segundos=8)
        if not texto:
            break
        limpio = " ".join(texto.split())
        vistos.append(limpio)
        F.log(f"   aviso ({cual}): {limpio[:200]}")
        t = limpio.lower()
        if F.AVISO_EXITO in t:
            F.cerrar_dialogo_jab()
            return limpio
        if "guardar los cambios" in t or "desea guardar" in t:
            F.cerrar_dialogo_jab(preferidos=("Si", "Sí"))
            time.sleep(F.PAUSA_MEDIA)
            continue
        F.cerrar_modales()
        raise RuntimeError(f"{cual}: SiAPe rechazo: {limpio[:250]}")
    if vistos:
        raise RuntimeError(f"{cual}: no pude cerrar los avisos: {' / '.join(vistos)[:250]}")
    # Sin aviso: no se da por guardado a ciegas.
    raise RuntimeError(f"{cual}: SiAPe no mostro confirmacion de guardado; revisar a mano.")


def procesar(F, cn, fila, hasta):
    abrir_cargos(F)
    _parar_si("menu", hasta)
    buscar_agente(F, fila)
    _parar_si("buscar", hasta)
    elegir_cargo_actual(F)
    _parar_si("cargo", hasta)
    ingresar_supervisor(F)
    _parar_si("supervisor", hasta)
    abrir_pestana_baja(F)
    _parar_si("pestana", hasta)

    if fila["estado"] != "PREVENTIVA":
        poner_fecha(F, fila["fecha_baja"])
        elegir_motivo(F, fila["motivo_preventivo"])
        _parar_si("preventiva-sin-guardar", hasta)
        conf = guardar(F, "preventiva")
        marcar(cn, fila["id"], "PREVENTIVA", f"{fila['motivo_preventivo']}: {conf}")
        F.log(f"   OK preventiva {fila['motivo_preventivo']}")
        _parar_si("preventiva", hasta)
        # Guardar saca a SiAPe del modo Supervisor (los campos dejan de ser
        # editables y la LOV responde "No puede escribir"): se vuelve a entrar.
        ingresar_supervisor(F)

    elegir_motivo(F, fila["motivo_definitivo"])
    conf = guardar(F, "definitiva")
    marcar(cn, fila["id"], "OK", f"{fila['motivo_definitivo']}: {conf}")
    F.log(f"   OK definitiva {fila['motivo_definitivo']}")


def siape_encima(F):
    """Deja la ventana de SiAPe 'siempre visible' mientras corre el robot.

    Los clicks y el tipeo van por coordenadas: si otra ventana (p.ej. una app
    maximizado) tapa a SiAPe, caen en esa otra ventana. Windows ademas no deja
    traer al frente desde un proceso en segundo plano ("SiAPe no quedo al
    frente"). Se engancha en F._activar_ventana (se llama antes de cada click,
    tambien en el login) y al salir se saca el TOPMOST."""
    import atexit
    import ctypes
    flags = 0x0001 | 0x0002 | 0x0040        # SWP_NOSIZE | SWP_NOMOVE | SWP_SHOWWINDOW
    puestos = set()
    original = F._activar_ventana

    def _minimizar_otras():
        # Ventana TOPMOST que se restaura sola (p.ej. al llegarle una
        # mensaje): antes de cada click se le saca el TOPMOST y se minimiza.
        try:
            import pygetwindow as gw
            for v in gw.getWindowsWithTitle(os.getenv("SIAPE_VENTANAS_A_MINIMIZAR", "")):
                if (v.title or "").strip() != os.getenv("SIAPE_VENTANAS_A_MINIMIZAR", ""):
                    continue
                ctypes.windll.user32.SetWindowPos(v._hWnd, -2, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
                if not v.isMinimized:
                    v.minimize()
                    time.sleep(0.4)
        except Exception as e:
            F.log(f"AVISO: no pude minimizar otras ventanas: {e}")

    def _activar_encima(w):
        _minimizar_otras()
        try:
            if w is not None:
                ctypes.windll.user32.SetWindowPos(w._hWnd, -1, 0, 0, 0, 0, flags)   # HWND_TOPMOST
                if w._hWnd not in puestos:
                    puestos.add(w._hWnd)
                    time.sleep(0.8)      # que el cambio de ventana no se coma el click siguiente
        except Exception as e:
            F.log(f"AVISO: no pude dejar SiAPe siempre visible: {e}")
        return original(w)

    _minimizar_otras()

    def _sacar():
        for h in puestos:
            ctypes.windll.user32.SetWindowPos(h, -2, 0, 0, 0, 0, flags)          # HWND_NOTOPMOST

    F._activar_ventana = _activar_encima
    atexit.register(_sacar)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="arma y muestra la cola, no toca SiAPe")
    ap.add_argument("--dni", type=int, help="solo este agente")
    ap.add_argument("--limit", type=int, help="procesar solo las primeras N bajas")
    ap.add_argument("--hasta", choices=PASOS, help="frenar despues de este paso (prueba)")
    args = ap.parse_args()

    cn = MN.conn()
    nuevos = generar(cn)
    cola = traer_cola(cn, dni=args.dni, limit=args.limit)
    print(f"Cola: {nuevos} baja(s) nuevas; {len(cola)} a procesar")
    for f in cola:
        print(f"  {f['dni']:<10} {f['nombre'] or '?':<36} leg {f['legajo'] or '-':<8} "
              f"{f['fecha_baja']:%d/%m/%Y} {f['origen']:<9} {f['estado']:<10} "
              f"{f['motivo_preventivo']} -> {f['motivo_definitivo']}")
    if args.dry_run or not cola:
        cn.close()
        return 0

    if args.hasta or args.dni:
        # prueba: SiAPe queda abierto para mirar la pantalla donde freno
        os.environ["SIAPE_CERRAR_AL_FINAL"] = "false"
    import cargar_francos_siape as F
    import pyautogui
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    pyautogui.PAUSE = F.PAUSA_CORTA

    # Un solo intento de login por corrida: si falla, cortar antes de que
    # SiAPe bloquee el usuario por intentos fallidos.
    login_original = F._hacer_login
    logins = {"n": 0}

    def _login_una_vez():
        if logins["n"] >= 1:
            raise RuntimeError("El login de SiAPe no entro al primer intento; corto para no bloquear el usuario.")
        logins["n"] += 1
        login_original()

    F._hacer_login = _login_una_vez
    F.asegurar_sesion()
    # recien despues del login: durante el tipeo de usuario/clave el cambio de
    # ventana (minimizar otras, TOPMOST) se comia el INGRESAR
    siape_encima(F)
    F.cerrar_modales()
    F.ventana_siape()

    hubo_error = False
    for fila in cola:
        F.log(f"-- {fila['dni']} {fila['nombre']} baja {fila['fecha_baja']:%d/%m/%Y} ------------")
        if not fila["nombre"]:
            marcar(cn, fila["id"], "ERROR", "El DNI no esta en personal")
            hubo_error = True
            continue
        try:
            procesar(F, cn, fila, args.hasta)
            MN.registrar_item(SCRIPT_ID, fila["dni"], fila["nombre"], "BAJA",
                              f"{fila['fecha_baja']:%d/%m/%Y}", f"{fila['fecha_baja']:%d/%m/%Y}", "ok",
                              f"{fila['motivo_preventivo']} -> {fila['motivo_definitivo']}")
        except Parada as p:
            F.log(f"   FRENO en el paso '{p}' (--hasta): la pantalla queda como esta.")
            break
        except Exception as e:
            F.log(f"   ERROR: {e}")
            marcar(cn, fila["id"], "ERROR", str(e))
            MN.registrar_item(SCRIPT_ID, fila["dni"], fila["nombre"], "BAJA",
                              f"{fila['fecha_baja']:%d/%m/%Y}", f"{fila['fecha_baja']:%d/%m/%Y}",
                              "error", str(e)[:600])
            hubo_error = True
            if args.dni:
                break          # prueba con un agente: dejar la pantalla para mirarla
            try:
                F.cerrar_modales()
            except Exception:
                pass

    cn.close()
    F.log("Listo.")
    return 1 if hubo_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Cancelado a mano (Ctrl+C).")
        sys.exit(130)
