"""
Baja de SIAPE (Personas -> Administracion -> pestaña LEGAJO DIGITAL) el CURRICULUM VITAE
la PLANILLA DE DATOS PERSONALES Y DE CONTACTOS y la CONSTANCIA ACEPTO DESIGNACION de los agentes de las tandas de
Tramites Documentales (tramites_tanda_interinos) y los deja en
D:\\G\\DOCU\\<dni>\\Curriculum\\ y D:\\G\\DOCU\\<dni>\\Planilla de datos personales\\
(las mismas carpetas que lee pase_planta.py). Si no existe la carpeta, la crea.

Pantalla mapeada en vivo el 17/11/2026 (internal frame "Administración de Personas"):
  - cabecera: APELLIDO / NOMBRE / CUIL-CUIT-CDI (solo lectura) + BUSCAR -> abre el
    "Buscador de Personas" (radio Documento + DNI + BUSCAR + grilla + ACEPTAR), el mismo
    de Tiempo Acumulado.
  - pestaña LEGAJO DIGITAL: combo "TIPO DE TRAMITE" (las opciones cambian por persona:
    LEGAJO PERSONAL, MIS ACTOS..., PASE A PLANTA PERMANENTE 2026 / 2025...). Al cambiar de
    persona vuelve a LEGAJO PERSONAL.
  - lista de documentos: 9 filas visibles (text name DOCUMENTO, x=46 relativo) con
    "NOMBRE (dd/mm/aaaa)". Solo existen como nodos las filas visibles: se recorre la lista
    con flecha arriba/abajo por PostMessage (sin mouse ni foco). Pasar el ultimo registro
    crea uno en blanco: una flecha arriba lo descarta sin cartel. NUNCA mover el foco a otro
    lado parado en el registro en blanco: sale "No puede dejar Datos en blanco".
  - cada fila habilita VER (reporte, ej. CV) o DESCARGAR (archivo, ej. planilla). Los dos
    abren en Chrome .../reports/rwservlet/getjobid<N>?server=rep_prod_wl01: se toma el N
    del titulo de la ventana de Chrome y el PDF se baja directo por HTTP (no pide sesion).
  - el combo se cambia con request_focus + 1 flecha por vez (Forms recarga la lista y se
    lleva el foco a la lista despues de cada cambio).

Por documento se elige la fila con la FECHA MAS NUEVA. Se guarda como
"Curriculum SIAPE dd-mm-aaaa.pdf" / "Planilla de datos personales SIAPE dd-mm-aaaa.pdf";
si ese archivo ya esta, no se vuelve a bajar. Nunca borra ni pisa nada.
Se verifica que el PDF traiga el DNI del agente antes de guardarlo.

Uso:
  python descargar_legajo_digital_siape.py --solo-lista
  python descargar_legajo_digital_siape.py --dni 12345678 --dry-run
  python descargar_legajo_digital_siape.py --tanda "TANDA 1"
  python descargar_legajo_digital_siape.py             # todas las tandas (sin RENOVACION*)
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import pypdf
import io

import cargar_francos_siape as F
from cargar_francos_siape import log, cerrar_modales
# cargar_stress_jab al importarse REEMPLAZA el login/entrada a eRreH de F por los suyos, y ese
# login hace caer SIAPE apenas se aprieta INGRESAR (19/11: SIAPE cerrado -> el robot quedaba
# esperando una ventana que no existe). De S/C solo se usan helpers de clic/teclado: se vuelve
# al login normal de F, el mismo de los otros robots de SIAPE.
_login_f, _erreh_f = F._hacer_login, F._entrar_erreh
import cargar_stress_jab as S
import corregir_stress_jab as C
F._hacer_login, F._entrar_erreh = _login_f, _erreh_f
import mapeo_novedades as MN

SCRIPT_ID = "siape_legajo_digital"
DOCU = Path(os.environ.get("DOCU_DIR", r"D:\G\DOCU"))
FRAME = "Administración de Personas"
FRAME_BUS = "Buscador de Personas"
TRAMITE_PREF = "PASE A PLANTA PERMANENTE 2026"
URL_JOB = "https://cloud.siape.gba.gob.ar/reports/rwservlet/getjobid{job}?server={srv}"
SERVIDORES = ["rep_prod_wl01", "rep_prod_wl02", "rep_prod_wl03", "rep_prod_wl04"]
ESPERA_JOB = 45

# documento de SIAPE -> (subcarpeta de DOCU, nombre de archivo)
DOCS = [
    ("CURRICULUM VITAE", "Curriculum", "Curriculum SIAPE"),
    ("PLANILLA DE DATOS PERSONALES Y DE CONTACTOS", "Planilla de datos personales",
     "Planilla de datos personales SIAPE"),
    ("CONSTANCIA ACEPTO DESIGNACION", "Constancia de Aceptacion SIAPE",
     "Constancia de aceptacion SIAPE"),
]
# La constancia de aceptacion se baja SIEMPRE, aunque falten los antecedentes (pedido 22/11).
SIEMPRE = {"CONSTANCIA ACEPTO DESIGNACION"}
# Si alguno de estos figura SIN fecha (en rojo en SIAPE) el agente no hizo la documentación:
# se deja de recorrer la lista y no se baja el CV ni la planilla (pedido del usuario 20/11);
# solo lo de SIEMPRE. En SIAPE los documentos con fecha van antes que los en rojo, asi que
# cortar ahi no pierde una constancia ya hecha.
CORTE_SI_FALTA = ("CERTIFICADO DE ANTECEDENTES PROVINCIALES", "CERTIFICADO DE REINCIDENCIA")
RX_FECHA = re.compile(r"^(.*?)\s*\((\d{2})/(\d{2})/(\d{4})\)\s*$")


# ───────────────────────── agentes ─────────────────────────

CLAVE_PEDIDO = "siape_legajo_digital_pedido"  # sync-guard:ignore (nombre de clave de config, no es secreto)


CLAVE_ESTADO = "siape_legajo_digital_estado"  # sync-guard:ignore (nombre de clave de config, no es secreto)


def guardar_estado(**datos):
    """Avance de la corrida para el panel de Tramites (nunca corta al robot)."""
    datos["actualizado"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute(
                "INSERT INTO app_runtime_config (config_key, config_json, created_at, updated_at) "
                "VALUES (%s, %s, NOW(), NOW()) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()",
                (CLAVE_ESTADO, json.dumps(datos, ensure_ascii=False)))
            cn.commit()
    except Exception as e:
        log(f"AVISO: no pude guardar el avance para la app: {e}")


def leer_pedido():
    """Lo que dejo el boton de Tramites (run_robot no pasa parametros): {tanda, dnis?}."""
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute("SELECT config_json FROM app_runtime_config WHERE config_key = %s", (CLAVE_PEDIDO,))
            r = cur.fetchone()
        if r and r.get("config_json"):
            return r["config_json"] if isinstance(r["config_json"], dict) else json.loads(r["config_json"])
    except Exception as e:
        log(f"AVISO: no pude leer el pedido de la app: {e}")
    return {}


def traer_agentes(cn, tanda=None, solo_dni=None, dnis=None):
    sql = ("SELECT t.dni, MIN(t.tanda) AS tanda, MAX(p.apellido) AS apellido, MAX(p.nombre) AS nombre "
           "FROM tramites_tanda_interinos t LEFT JOIN personal p ON p.dni = t.dni")
    where, params = [], []
    if tanda:
        where.append("t.tanda = %s")
        params.append(tanda)
    elif not solo_dni:
        where.append("t.tanda NOT LIKE 'RENOVACI%%'")   # renovaciones de extranjeros: no es pase a planta
    if solo_dni:
        where.append("t.dni = %s")
        params.append(int(solo_dni))
    if dnis:
        where.append("t.dni IN (" + ",".join(["%s"] * len(dnis)) + ")")
        params.extend(int(d) for d in dnis)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY t.dni ORDER BY MIN(t.tanda), apellido, nombre"
    with cn.cursor() as c:
        c.execute(sql, params)
        filas = c.fetchall()
    if solo_dni and not filas:
        filas = [{"dni": int(solo_dni), "tanda": None, "apellido": None, "nombre": None}]
    return filas


def nombre_ag(r):
    return f"{r.get('apellido') or ''}, {r.get('nombre') or ''}".strip(", ")



def ya_tiene_siape(dni):
    """True si todas las subcarpetas de DOCS ya tienen un archivo bajado por este robot."""
    for _doc, sub, base in DOCS:
        d = DOCU / str(dni) / sub
        if not (d.is_dir() and any(p.name.startswith(base) for p in d.iterdir())):
            return False
    return True


# ───────────────────────── JAB helpers ─────────────────────────

def _visible(b):
    x = (b or {}).get("x")
    return x is not None and x >= 0      # OJO: x puede ser 0 (la ventana esta en x=0)


def _estados(el):
    try:
        return el.get_element_information().get("states") or []
    except Exception:
        return []


def _buscar_frame(prefijo, timeout=20):
    limite = time.time() + timeout
    while time.time() < limite:
        for el, _d, i in F._jab_walk(max_depth=12, max_nodes=4000, max_segundos=20):
            b = i.get("bounds") or {}
            if (i.get("role") == "internal frame" and (i.get("name") or "").strip().startswith(prefijo)
                    and _visible(b)):
                return el
        time.sleep(1)
    return None


def _boton_cartel():
    """Boton Continuar/Aceptar VISIBLE de un cartel de Forms (o None)."""
    for el, _d, i in F._jab_walk(max_depth=20, max_nodes=4000, max_segundos=30):
        nom = (i.get("name") or "").strip()
        if (i.get("role") == "push button" and _visible(i.get("bounds"))
                and (nom.startswith("Continuar") or nom.startswith("Aceptar"))):
            return el
    return None


def _cerrar_aviso(buscar_boton=False):
    """Cierra un cartel de Forms apretando su Continuar/Aceptar por accion JAB (cerrar_modales
    NO cierra el "Ultimo Dato", y con el cartel abierto se pierden todas las flechas).
    leer_dialogo_jab a veces no ve el cartel: con buscar_boton=True se busca el boton igual.
    Devuelve el texto del cartel ('(cartel)' si no se pudo leer) o None si no habia."""
    aviso, _ = F.leer_dialogo_jab(max_segundos=3)
    if not aviso and not buscar_boton:
        return None
    cerrado = None
    for _ in range(3):
        boton = _boton_cartel()
        if boton is None:
            return cerrado or aviso
        S._click(boton, simulate=False)
        cerrado = aviso or "(cartel)"
        time.sleep(1.5)
    if _boton_cartel() is not None:
        raise RuntimeError(f"No pude cerrar el cartel de SIAPE: {(aviso or '')[:150]}")
    return cerrado


def abrir_pantalla():
    fr = _buscar_frame(FRAME, timeout=5)
    if fr:
        return fr
    menu = None
    for el, _d, i in F._jab_walk(max_depth=10, max_nodes=3000, max_segundos=30):
        if i.get("role") == "menu" and (i.get("name") or "").startswith("Personas"):
            menu = el
            break
    if not menu:
        raise RuntimeError("No encontre el menu 'Personas' en SIAPE.")
    item = None
    for el, _d, i in F._jab_walk(root=menu, max_depth=3, max_nodes=100, max_segundos=10):
        if i.get("role") == "menu item" and (i.get("name") or "").startswith("Administraci"):
            item = el
            break
    if not item or not S._click(item, simulate=False):
        raise RuntimeError("No pude abrir Personas -> Administración.")
    fr = _buscar_frame(FRAME, timeout=40)
    if not fr:
        raise RuntimeError("No se abrio 'Administración de Personas'.")
    return fr


class Pantalla:
    """Referencias a los controles de la ventana (se releen despues de cada persona)."""

    def __init__(self, fr):
        self.fr = fr
        self.releer()

    def releer(self):
        self.header = {}
        self.buscar = self.combo = self.ver = self.descargar = self.tab_ld = None
        filas = {}
        for el, _d, i in F._jab_walk(root=self.fr, max_depth=25, max_nodes=6000, max_segundos=60):
            b = i.get("bounds") or {}
            rol, nom = i.get("role"), (i.get("name") or "")
            if not _visible(b):
                continue
            if rol == "push button" and nom == "BUSCAR" and self.buscar is None:
                self.buscar = el
            elif rol == "text" and nom in ("APELLIDO", "NOMBRE", "CUIL-CUIT-CDI"):
                self.header[nom] = el
            elif rol == "page tab" and nom == "LEGAJO DIGITAL":
                self.tab_ld = (el, i)
            elif rol == "combo box" and nom == "TIPO DE TRAMITE":
                self.combo = el
            elif rol == "push button" and nom == "VER":
                self.ver = el
            elif rol == "push button" and nom == "DESCARGAR":
                self.descargar = el
            elif rol == "text" and nom.endswith("DOCUMENTO"):
                filas.setdefault(b.get("y"), {})["doc"] = el
            elif rol == "text" and not nom and (b.get("width") or 99) <= 14:
                filas.setdefault(b.get("y"), {})["marca"] = el
        self.filas = [filas[y] for y in sorted(filas) if "doc" in filas[y]]

    def cuil(self):
        el = self.header.get("CUIL-CUIT-CDI")
        return F._jab_read_text(el).strip() if el else ""

    # ---- lista de documentos ----
    def actual(self):
        """Texto del registro donde esta el foco (None si el foco no esta en la lista)."""
        for f in self.filas:
            for e in f.values():
                if "enfocado" in _estados(e):
                    return F._jab_read_text(f["doc"]).strip()
        return None

    def foto(self):
        """(textos visibles, fila enfocada): si no cambia tras una flecha, no se movio."""
        foco = None
        for k, f in enumerate(self.filas):
            if any("enfocado" in _estados(e) for e in f.values()):
                foco = k
        return tuple(F._jab_read_text(f["doc"]).strip() for f in self.filas), foco


def _es_ultimo_dato(aviso):
    return "ltimo Dato" in (aviso or "") or "rimer Dato" in (aviso or "")


# ───────────────────────── pasos ─────────────────────────

def buscar_persona(p, dni):
    if not p.buscar:
        raise RuntimeError("No encontre BUSCAR en Administración de Personas.")
    S._click(p.buscar, simulate=False)
    bf = _buscar_frame(FRAME_BUS, timeout=25)
    if not bf:
        raise RuntimeError("No abrio el Buscador de Personas.")
    radio = campo = bus = acep = canc = None
    visto = False
    for el, _d, i in F._jab_walk(root=bf, max_depth=22, max_nodes=3000, max_segundos=40):
        rol, nom = i.get("role"), (i.get("name") or "").strip()
        if rol == "radio button" and nom.startswith("Documento"):
            radio = el
        elif rol == "push button" and nom == "...":
            visto = True
        elif visto and rol == "text" and campo is None:
            campo = el
        elif rol == "push button" and nom == "BUSCAR":
            bus = el
        elif rol == "push button" and nom.startswith("ACEPTAR"):
            acep = el
        elif rol == "push button" and nom.startswith("CANCELAR"):
            canc = el
    if not (campo and bus and acep):
        raise RuntimeError("No encontre los controles del Buscador de Personas.")
    if radio:
        S._click(radio, simulate=False)
        time.sleep(0.8)
    S._tipear(campo, str(dni))
    if F._jab_read_text(campo).strip() != str(dni):
        raise RuntimeError(f"El campo DNI del Buscador no quedo con {dni}.")
    S._click(bus, simulate=False)
    # primera fila de resultados: el texto sin nombre (x despues de TIPO NRO. DOCUMENTO) = numero
    limite = time.time() + 30
    nro = ape = ""
    while time.time() < limite:
        time.sleep(2)
        fila_y, celdas = None, {}
        for el, _d, i in F._jab_walk(root=bf, max_depth=22, max_nodes=3000, max_segundos=40):
            b = i.get("bounds") or {}
            if i.get("role") != "text":
                continue
            nom = i.get("name") or ""
            if nom == "APELLIDO Y NOMBRE" and fila_y is None:
                fila_y = b.get("y")
            if fila_y is not None and b.get("y") == fila_y:
                celdas.setdefault(nom, F._jab_read_text(el).strip())
        ape, nro = celdas.get("APELLIDO Y NOMBRE", ""), celdas.get("", "")
        # 19/11: el Buscador de SIAPE trae la fila SIN apellido ni CUIL (legajo 0, CUIL "--")
        # aunque la persona existe y al ACEPTAR carga completa. Vale la fila si el DNI coincide;
        # después de ACEPTAR se confirma con el CUIL de la ficha.
        if ape or nro == str(dni):
            break
    if not ape and nro != str(dni):
        if canc:
            S._click(canc, simulate=False)
        raise RuntimeError(f"El Buscador de SIAPE no encontro el DNI {dni}.")
    if nro != str(dni):
        if canc:
            S._click(canc, simulate=False)
        raise RuntimeError(f"El Buscador trajo otro documento ({nro} {ape}); no sigo.")
    S._click(acep, simulate=False)
    limite = time.time() + 30
    while time.time() < limite:
        time.sleep(2)
        if re.sub(r"\D", "", p.cuil()).find(str(dni)) >= 0:
            if not ape:  # el Buscador no lo trajo: se toma de la ficha
                p.releer()
                ape = ", ".join(x for x in (F._jab_read_text(p.header[k]).strip()
                                            for k in ("APELLIDO", "NOMBRE") if p.header.get(k)) if x)
            return ape or str(dni)
    raise RuntimeError(f"Despues de ACEPTAR la pantalla no muestra el CUIL de {dni} (lei {p.cuil()!r}).")


def ir_a_legajo_digital(p):
    el, info = p.tab_ld or (None, None)
    if not el:
        raise RuntimeError("No encontre la pestaña LEGAJO DIGITAL.")
    if "seleccionado" in _estados(el):
        return
    F._activar_ventana(F._buscar_ventana_siape())
    F._jab_click_bounds(info)
    time.sleep(3)
    if "seleccionado" not in _estados(el):
        raise RuntimeError("No pude abrir la pestaña LEGAJO DIGITAL.")


def opciones_combo(p):
    ops = []
    for _el, _d, i in F._jab_walk(root=p.combo, max_depth=4, max_nodes=60, max_segundos=10):
        if i.get("role") == "label":
            ops.append(((i.get("name") or "").strip(), "seleccionado" in (i.get("states") or [])))
    return ops


def elegir_tramite(p):
    """Deja el combo en PASE A PLANTA PERMANENTE 2026. Si la persona no tiene esa opcion no
    esta en la tanda 2026 de SIAPE (ej. TORRES solo tiene la 2025): devuelve None."""
    nombres = []
    for _ in range(3):            # el combo puede tardar en traer las opciones de la persona
        nombres = [n for n, _s in opciones_combo(p)]
        if TRAMITE_PREF in nombres:
            break
        time.sleep(3)
        p.releer()
    if "LEGAJO PERSONAL" not in nombres:
        raise RuntimeError(f"No pude leer bien las opciones de TIPO DE TRAMITE (lei {nombres}).")
    if TRAMITE_PREF not in nombres:
        return None
    objetivo = TRAMITE_PREF
    meta = nombres.index(objetivo)
    # Cada flecha con el combo ENFOCADO y CERRADO cambia el valor al toque; Forms recarga la
    # lista y se lleva el foco a la lista. Por eso: un paso por vez, re-enfocando el combo.
    # Ojo: la marca 'seleccionado' sigue al valor real solo si el cambio fue de verdad
    # (con la API de seleccion de JAB cambia la marca y NO el valor: no usarla).
    for _ in range(len(nombres) + 2):
        ops = opciones_combo(p)
        actual = next((k for k, (_n, s) in enumerate(ops) if s), 0)
        if actual == meta:
            time.sleep(2)
            return objetivo
        enfocado = False
        for _i in range(4):
            p.combo._request_focus()
            time.sleep(1.2)
            if "enfocado" in _estados(p.combo):
                enfocado = True
                break
            S._wm_key(0x1B, 0x01)     # Escape: cierra la lista desplegable si quedo abierta
            time.sleep(1)
        if not enfocado:
            raise RuntimeError("No pude poner el foco en TIPO DE TRAMITE.")
        (C._wm_down if meta > actual else C._wm_up)(1)
        limite = time.time() + 15        # espera a que Forms recargue la lista (saca el foco del combo)
        while time.time() < limite and "enfocado" in _estados(p.combo):
            time.sleep(0.5)
        time.sleep(2)
        aviso = _cerrar_aviso()
        if aviso:
            raise RuntimeError(f"SIAPE al cambiar el tipo de tramite: {aviso[:200]}")
        nuevo = next((k for k, (_n, s) in enumerate(opciones_combo(p)) if s), 0)
        if abs(nuevo - actual) != 1:
            raise RuntimeError(f"El combo salto de {nombres[actual]!r} a {nombres[nuevo]!r}; no sigo.")
    raise RuntimeError(f"No pude dejar el combo en {objetivo}.")


def _descartar_blanco(p, intentos=4):
    """Si el foco quedo en un registro EN BLANCO que Forms agrego al pasar el ultimo (y hay
    otros registros con texto), flecha arriba lo descarta. Hay que hacerlo antes de cualquier
    otra cosa: con el foco ahi, BUSCAR o el combo disparan "No puede dejar Datos en blanco"."""
    for _ in range(intentos):
        if p.actual() != "" or not any(p.foto()[0]):
            return
        log("   registro en blanco en la lista: lo descarto con flecha arriba")
        C._wm_up(1)
        time.sleep(1.5)
        aviso = _cerrar_aviso()
        if aviso and not _es_ultimo_dato(aviso):
            log(f"   AVISO al descartar el registro en blanco: {aviso[:150]}")
    if p.actual() == "" and any(p.foto()[0]):
        raise RuntimeError("Quedo un registro en blanco en la lista y no lo pude descartar.")


def _al_principio(p):
    """Pone el foco en la lista (si no esta) y sube hasta el primer registro. Devuelve el
    texto del primero ('' si el tramite no tiene documentos)."""
    p.releer()
    if not p.filas:
        raise RuntimeError("No encuentro la lista de documentos.")
    for _ in range(3):
        if p.actual() is not None:
            break
        p.filas[0]["doc"]._request_focus()
        time.sleep(1.2)
    if p.actual() is None:
        raise RuntimeError("No pude poner el foco en la lista de documentos.")
    _descartar_blanco(p)
    if p.actual() == "":
        return ""          # tramite sin documentos (un solo registro en blanco)
    prev = None
    for _ in range(12):     # en el primero Forms puede avisar "Primer Dato"
        C._wm_up(10)
        time.sleep(1.2)
        f = p.foto()
        if f == prev:
            break
        prev = f
    aviso = _cerrar_aviso(buscar_boton=True)
    if aviso and not _es_ultimo_dato(aviso) and aviso != "(cartel)":
        raise RuntimeError(f"SIAPE subiendo la lista: {aviso[:200]}")
    if p.actual() is None:     # cerrar el cartel se lleva el foco: se repone en la 1ra fila visible
        p.filas[0]["doc"]._request_focus()
        time.sleep(1.2)
    return p.actual()


def _faltan_antecedentes(lista):
    """Certificados de antecedentes que figuran sin fecha (= en rojo, no hechos)."""
    vistos = {(t or "").strip().upper() for t in lista}
    return [d for d in CORTE_SI_FALTA if d in vistos]


def leer_lista(p):
    """Recorre la lista entera con las flechas y devuelve [texto] en orden."""
    primero = _al_principio(p)
    if not primero:
        return []
    lista = [primero]
    prev = p.foto()
    for _ in range(150):
        C._wm_down(1)
        time.sleep(0.9)
        a = p.actual()
        if a == "" or a is None:
            time.sleep(1.5)          # dejar que Forms termine de crear el registro en blanco
            _descartar_blanco(p)     # paso el ultimo: flecha arriba lo descarta
            break
        f = p.foto()
        if f == prev:
            break           # no se movio: era el ultimo (Forms avisa "Ultimo Dato")
        prev = f
        lista.append(a)
        if _faltan_antecedentes([a]):
            log(f"   {a.strip()} en rojo (sin fecha): dejo de recorrer la lista")
            break
    aviso = _cerrar_aviso(buscar_boton=True)
    if aviso and not _es_ultimo_dato(aviso) and aviso != "(cartel)":
        raise RuntimeError(f"SIAPE recorriendo la lista: {aviso[:200]}")
    time.sleep(1)
    _descartar_blanco(p)
    log(f"   lista: {len(lista)} documento(s): {' / '.join(lista)[:600]}")
    return lista


def elegir(lista, doc):
    """(indice, fecha) de la fila de `doc` con la fecha mas nueva (la primera si empatan)."""
    mejor = None
    for k, t in enumerate(lista):
        m = RX_FECHA.match(t or "")
        if not m or m.group(1).strip().upper() != doc:
            continue
        f = datetime(int(m.group(4)), int(m.group(3)), int(m.group(2)))
        if mejor is None or f > mejor[1]:
            mejor = (k, f)
    return mejor


def _foco_en_lista(p):
    """Despues de cerrar un cartel el foco sale de la lista: request_focus lo devuelve al
    registro ACTUAL de Forms (no a la fila que uno toca)."""
    for _ in range(3):
        if p.actual() is not None:
            return
        p.filas[0]["doc"]._request_focus()
        time.sleep(1.5)
    raise RuntimeError("No pude devolver el foco a la lista de documentos.")


def _posicion(p, lista):
    """Indice en `lista` del registro actual: ubica las filas visibles dentro de la lista
    (son un tramo seguido) y le suma la fila enfocada."""
    vis, foco = p.foto()
    vis = list(vis)
    while vis and not vis[-1]:
        vis.pop()
    if foco is None or not vis or foco >= len(vis):
        return None
    inicios = [w for w in range(len(lista) - len(vis) + 1) if lista[w:w + len(vis)] == vis]
    if len(inicios) != 1:
        return None
    return inicios[0] + foco


def ir_a(p, lista, destino):
    """Se mueve de a UNA flecha (las rafagas pierden teclas) hasta `destino` y verifica."""
    _foco_en_lista(p)
    for _ in range(4):
        pos = _posicion(p, lista)
        for _r in range(3):              # el foco puede tardar en volver a la lista
            if pos is not None:
                break
            _cerrar_aviso(buscar_boton=True)
            time.sleep(1.5)
            if p.actual() is None:
                p.filas[0]["doc"]._request_focus()
                time.sleep(1.5)
            pos = _posicion(p, lista)
        if pos is None:
            raise RuntimeError(f"No pude ubicar en que fila de la lista estoy ({p.actual()!r}).")
        if pos == destino:
            break
        paso = C._wm_up if destino < pos else C._wm_down
        for _ in range(abs(pos - destino)):
            paso(1)
            time.sleep(1.0)
        time.sleep(1)
    if _posicion(p, lista) != destino or p.actual() != lista[destino]:
        raise RuntimeError(f"Quise pararme en {lista[destino]!r} y quede en {p.actual()!r}.")


def _jobs():
    import win32gui
    vistos = {}

    def f(h, _):
        m = re.search(r"getjobid(\d+)", win32gui.GetWindowText(h) or "")
        if m and win32gui.IsWindowVisible(h):
            vistos[int(m.group(1))] = h
    win32gui.EnumWindows(f, None)
    return vistos


def _cerrar_pestania(job, hwnd):
    """Cierra la pestaña de Chrome del reporte (Ctrl+W) solo si esa ventana quedo adelante."""
    import win32gui
    try:
        F._forzar_foreground(hwnd)
        time.sleep(0.6)
        fg = win32gui.GetForegroundWindow()
        if fg == hwnd and f"getjobid{job}" in (win32gui.GetWindowText(fg) or ""):
            F.pyautogui.hotkey("ctrl", "w")
            time.sleep(0.5)
    except Exception:
        pass


def bajar_pdf(job):
    for srv in SERVIDORES:
        try:
            with urllib.request.urlopen(URL_JOB.format(job=job, srv=srv), timeout=60) as r:
                data = r.read()
        except Exception:
            continue
        if data[:5] == b"%PDF-":
            return data
    raise RuntimeError(f"No pude bajar el PDF del reporte getjobid{job} (ningun servidor devolvio PDF).")


def abrir_y_bajar(p, dni):
    """En el registro actual toca VER o DESCARGAR, espera la pestaña de Chrome y baja el PDF."""
    p.releer()
    boton = None
    if p.ver is not None and "activado" in _estados(p.ver):
        boton = p.ver
    elif p.descargar is not None and "activado" in _estados(p.descargar):
        boton = p.descargar
    if boton is None:
        raise RuntimeError("Ni VER ni DESCARGAR estan habilitados en esa fila.")
    antes = set(_jobs())
    F._jab_click_element(boton)
    limite = time.time() + ESPERA_JOB
    nuevos = {}
    while time.time() < limite and not nuevos:
        time.sleep(1)
        nuevos = {j: h for j, h in _jobs().items() if j not in antes}
    if not nuevos:
        aviso = _cerrar_aviso()
        raise RuntimeError("No se abrio el reporte en Chrome" + (f" (SIAPE: {aviso[:150]})" if aviso else "") + ".")
    job = max(nuevos)
    data = bajar_pdf(job)
    _cerrar_pestania(job, nuevos[job])
    try:
        txt = " ".join((pg.extract_text() or "") for pg in pypdf.PdfReader(io.BytesIO(data)).pages)
    except Exception as e:
        raise RuntimeError(f"No pude leer el PDF de getjobid{job}: {e}")
    if str(dni) not in re.sub(r"\D", "", txt):
        raise RuntimeError(f"El PDF de getjobid{job} no trae el DNI {dni}; no lo guardo.")
    return data, job


def procesar(p, r, dry_run=False):
    dni = r["dni"]
    p.releer()
    _descartar_blanco(p)
    ape = buscar_persona(p, dni)
    p.releer()
    ir_a_legajo_digital(p)
    p.releer()
    tramite = elegir_tramite(p)
    if not tramite:
        return "sin_tramite", f"{ape}: no tiene {TRAMITE_PREF} en Legajo Digital (no esta en la tanda 2026 de SIAPE)"
    lista = leer_lista(p)
    faltan = _faltan_antecedentes(lista)
    docs = [d for d in DOCS if d[0] in SIEMPRE] if faltan else DOCS
    partes, errores, bajados = [], 0, 0
    for doc, sub, base in docs:
        e = elegir(lista, doc)
        if not e:
            partes.append(f"{sub}: no esta en SIAPE")
            continue
        k, fecha = e
        destino = DOCU / str(dni) / sub / f"{base} {fecha:%d-%m-%Y}.pdf"
        if destino.exists():
            partes.append(f"{sub}: ya estaba {destino.name}")
            continue
        if dry_run:
            partes.append(f"{sub}: bajaria {lista[k]}")
            continue
        ultimo_error = None
        for intento in range(2):         # un reintento por documento
            try:
                ir_a(p, lista, k)
                data, job = abrir_y_bajar(p, dni)
                destino.parent.mkdir(parents=True, exist_ok=True)
                destino.write_bytes(data)
                MN.auditar_docu(SCRIPT_ID, dni, destino, sub, f"{lista[k]} | job {job} | {tramite}")
                partes.append(f"{sub}: {destino.name} (job {job})" + (" [2do intento]" if intento else ""))
                bajados += 1
                ultimo_error = None
                break
            except Exception as ex:
                ultimo_error = ex
                log(f"   {sub}: intento {intento + 1} fallo: {str(ex)[:200]}")
                time.sleep(3)
        if ultimo_error is not None:
            errores += 1
            partes.append(f"{sub}: ERROR {str(ultimo_error)[:200]}")
    det = f"[{tramite}] " + " | ".join(partes)
    if faltan:
        det = (f"[{tramite}] {ape}: no hizo " + " ni ".join(faltan)
               + " (en rojo en SIAPE); no se baja CV ni Planilla | " + " | ".join(partes))
        return ("error" if errores else "sin_documentacion"), det
    if errores:
        return "error", det
    if dry_run:
        return "dry_run", det
    return ("ok" if bajados else "ya_estaba"), det


# ───────────────────────── main ─────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tanda")
    ap.add_argument("--dni")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--forzar", action="store_true",
                    help="revisa SIAPE aunque ya tenga los dos archivos (por si hay uno mas nuevo)")
    ap.add_argument("--dry-run", action="store_true", help="lee SIAPE pero NO baja nada")
    ap.add_argument("--solo-lista", action="store_true", help="lista los agentes, sin tocar SIAPE")
    args = ap.parse_args()

    dnis = None
    if not args.tanda and not args.dni:
        # lanzado por el boton "⬇️ Legajo SIAPE" de Tramites (via run_robot)
        ped = leer_pedido()
        args.tanda = ped.get("tanda") or None
        dnis = [int(d) for d in (ped.get("dnis") or []) if str(d).isdigit()] or None
        if args.tanda or dnis:
            log(f"Pedido de la app: tanda={args.tanda!r}" + (f", {len(dnis)} DNI elegido(s)" if dnis else ""))

    cn = F.conn()
    todos = traer_agentes(cn, tanda=args.tanda, solo_dni=args.dni, dnis=dnis)
    cn.close()
    pend = [r for r in todos if args.forzar or args.dni or dnis or not ya_tiene_siape(r["dni"])]
    completos = len(todos) - len(pend)
    if args.limit:
        pend = pend[:args.limit]
    log(f"Agentes en tandas: {len(todos)}; ya completos: {completos}; para procesar: {len(pend)}")
    if args.solo_lista:
        for r in pend:
            log(f"  {r['dni']}  {nombre_ag(r)}  [{r.get('tanda') or '-'}]")
        return 0
    if not pend:
        return 0

    inicio = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    base = {"corriendo": True, "inicio": inicio, "tanda": args.tanda, "total": len(pend)}
    guardar_estado(**base, hechos=0, actual=None)
    try:
        return _correr(args, pend, base)
    except BaseException as e:
        guardar_estado(**{**base, "corriendo": False}, fin=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                       error=str(e)[:300] or e.__class__.__name__)
        raise


def _correr(args, pend, base):
    F.pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    F.asegurar_sesion()
    cerrar_modales()
    p = Pantalla(abrir_pantalla())

    errores = bajados = 0
    for n, r in enumerate(pend):
        guardar_estado(**base, hechos=n, actual={"dni": r["dni"], "nombre": nombre_ag(r)})
        log(f"-> {r['dni']} {nombre_ag(r)}" + (" [DRY-RUN]" if args.dry_run else ""))
        try:
            estado, motivo = procesar(p, r, dry_run=args.dry_run)
        except Exception as e:
            estado, motivo = "error", str(e)[:400]
            cerrar_modales()
            try:
                p = Pantalla(abrir_pantalla())
            except Exception as e2:
                log(f"   ERROR: {motivo}")
                log(f"   No pude volver a Administración de Personas ({e2}); freno la corrida.")
                MN.registrar_item(SCRIPT_ID, r["dni"], nombre_ag(r), "Legajo digital", None, None, "error", motivo)
                errores += 1
                break
        log(f"   {estado}: {motivo}")
        MN.registrar_item(SCRIPT_ID, r["dni"], nombre_ag(r), "Legajo digital", None, None,
                          {"ok": "ok", "error": "error"}.get(estado, "aviso"), f"{estado}: {motivo}")
        errores += estado == "error"
        bajados += estado == "ok"
    log(f"Listo: {len(pend)} procesado(s), {bajados} con descargas, {errores} con error.")
    guardar_estado(**{**base, "corriendo": False}, hechos=len(pend), bajados=bajados, errores=errores,
                   fin=datetime.now().strftime("%Y-%m-%dT%H:%M:%S"))
    return 1 if errores else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Cancelado.")
        sys.exit(130)
