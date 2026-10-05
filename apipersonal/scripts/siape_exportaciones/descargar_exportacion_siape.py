"""
Descarga automatizada de "Consultas a Exportar" de SIAPE (menu Exportaciones
-> Consultas a Exportar): navega por teclado (sin coordenadas fijas, ver
`siape_mapping_exportaciones_2026-09-22.md`), abre la consulta pedida, carga
el periodo, confirma, espera que Chrome baje el archivo a Descargas, y lo
copia/renombra al destino configurado. Registra el resultado (ok/error) en
la tabla `script_runs` para el dashboard (Herramientas -> Robots SIAPE).

Cada consulta puede pedir el modal PERIODO (Desde/Hasta), el modal FECHA (un
solo dia) o ninguno (Consolidado, Pendientes): el robot detecta cual aparece
despues de apretar Exportar y lo completa segun `periodo` de CONSULTAS.

Uso:
  python descargar_exportacion_siape.py --all
  python descargar_exportacion_siape.py --consulta "Novedades Por Periodo"
  python descargar_exportacion_siape.py --consulta "Novedades Por Periodo" --desde 01/09/2026 --hasta 31/12/2026
  python descargar_exportacion_siape.py --consulta "Horario Guardia Salud a un dia" --fecha 26/09/2026
"""
import argparse
import ctypes

ctypes.windll.user32.SetProcessDPIAware()  # ANTES de pygetwindow/pyautogui: ver mapping del 2026-09-22

import shutil
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # para importar cargar_francos_siape

import pyautogui

import cargar_francos_siape as F
import cargar_stress_jab as SJ
from cargar_stress_jab import _forzar_frente_seguro

pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE  # mismo criterio que cargar_stress_jab.py / corregir_stress_jab.py

DESCARGAS_DIR = Path.home() / "Downloads"
COMPARACION = Path(r"D:\G\comparacion")
CAPTURAS_DIR = Path(__file__).resolve().parents[1] / "logs" / "capturas"
CAPTURAS_DIAS = 7            # se borran las capturas mas viejas que esto
SESION_INTENTOS = 3          # intentos completos (cerrar Java + relanzar + login + eRreH)
SESION_TIMEOUT_INTENTO = 240
SIAPE_MUERTO_SEG = 15        # sin PROCESO Java este tiempo seguido = se cerro solo
# OJO: tras INGRESAR SiAPe OCULTA su ventana ~40-50s (Java sigue vivo). Faltar la
# ventana NO es estar muerto: matarlo ahi era lo que lo "cerraba" (04/10/2026).
PROCESOS_JAVA = ("jp2launcher.exe", "javaw.exe", "java.exe")
CONSULTA_INTENTOS = 2

# periodo: como se completa el modal si aparece.
#   "mes_a_fin" -> PERIODO dia 1 del MES ANTERIOR .. fin de anio (ver calcular_periodo)
#   "anio"      -> PERIODO 01/01 .. 31/12 del anio en curso
#   "hoy"       -> FECHA = hoy
#   None        -> la consulta no pide fechas (si igual aparece un modal, se usa hoy / mes_a_fin)
# nro: "NRO. DE CONSULTA" de la grilla; SOLO confirma la fila (se busca por nombre):
#   JAB a veces lee los numeros corridos una fila (05/10/2026).
# Los nombres de destino que ya existian en comparacion se respetan (los leen
# otras paginas): HORARIOS.xlsx = consulta 76, "plantel nominado.xlsx" = 1.
CONSULTAS = {
    "Examenes Médicos Salud": {
        "nro": 123,
        "script_id": "siape_examenes_medicos",
        "descripcion": "Exportación Exámenes Médicos Salud (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "EXAMENES_MEDICOS.xlsx",
        "periodo": "anio",
    },
    "Horario Administrativo a un dia": {
        "nro": 76,
        "script_id": "siape_horario_admin_dia",
        "descripcion": "Exportación Horario Administrativo a un día (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIOS.xlsx",
        "periodo": "hoy",
    },
    "Horario Administrativo Consolidado de los Agentes": {
        "nro": 71,
        "script_id": "siape_horario_admin_consolidado",
        "descripcion": "Exportación Horario Administrativo Consolidado (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIO_CONSOLIDADO.xlsx",
        "periodo": None,
    },
    "Horario Guardia Salud a un dia": {
        "nro": 82,
        "script_id": "siape_horario_guardia_dia",
        "descripcion": "Exportación Horario Guardia Salud a un día (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIO_GUARDIA.xlsx",
        "periodo": "hoy",
    },
    "Licencias Médicas": {
        "nro": 5,
        "script_id": "siape_licencias_medicas",
        "descripcion": "Exportación Licencias Médicas (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "LICENCIAS_MEDICAS.xlsx",
        "periodo": "mes_a_fin",
    },
    "Novedades Pendientes de Autorización": {
        "nro": 77,
        "script_id": "siape_novedades_pendientes",
        "descripcion": "Exportación Novedades Pendientes de Autorización (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "NOVEDADES_PENDIENTES.xlsx",
        "periodo": None,
    },
    "Novedades Por Periodo": {
        "nro": 4,
        "script_id": "siape_novedades_por_periodo",
        "descripcion": "Exportación Novedades Por Periodo (SIAPE)",
        "destino_dir": COMPARACION / "SIAPE",
        "destino_nombre": "SIAPE.xlsx",
        "periodo": "mes_a_fin",
    },
    "Novedades Rechazadas": {
        "nro": 79,
        "script_id": "siape_novedades_rechazadas",
        "descripcion": "Exportación Novedades Rechazadas (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "NOVEDADES_RECHAZADAS.xlsx",
        "periodo": "hoy",
    },
    "Plantel Nominado": {
        "nro": 1,
        "script_id": "siape_plantel_nominado",
        "descripcion": "Exportación Plantel Nominado (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "plantel nominado.xlsx",
        "periodo": None,
    },
}


# =================== capturas de diagnostico ===================
_CAPTURA_PREFIJO = {"txt": time.strftime("%Y%m%d_%H%M%S")}


def capturar(etapa):
    """Guarda una imagen DE LA VENTANA de SiAPe (PrintWindow: sale aunque otra
    ventana la tape). Si no hay ventana, captura la pantalla entera y lo anota.
    Nunca corta el robot."""
    try:
        from PIL import Image, ImageGrab
        CAPTURAS_DIR.mkdir(parents=True, exist_ok=True)
        nombre = CAPTURAS_DIR / f"{_CAPTURA_PREFIJO['txt']}_{etapa}.png"
        w = F._buscar_ventana_siape()
        h = getattr(w, "_hWnd", None) if w else None
        if not h:
            ImageGrab.grab(all_screens=True).save(nombre.with_name(nombre.stem + "_SIN_VENTANA.png"))
            F.log(f"   [captura] {etapa}: no hay ventana de SiAPe (guarde la pantalla)")
            return
        import win32gui
        import win32ui
        l, t, r, b = win32gui.GetWindowRect(h)
        ancho, alto = max(r - l, 1), max(b - t, 1)
        hdc = win32gui.GetWindowDC(h)
        mfc = win32ui.CreateDCFromHandle(hdc)
        mem = mfc.CreateCompatibleDC()
        bmp = win32ui.CreateBitmap()
        bmp.CreateCompatibleBitmap(mfc, ancho, alto)
        mem.SelectObject(bmp)
        ctypes.windll.user32.PrintWindow(h, mem.GetSafeHdc(), 2)   # PW_RENDERFULLCONTENT
        info = bmp.GetInfo()
        img = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]),
                               bmp.GetBitmapBits(True), "raw", "BGRX", 0, 1)
        img.save(nombre)
        win32gui.DeleteObject(bmp.GetHandle())
        mem.DeleteDC()
        mfc.DeleteDC()
        win32gui.ReleaseDC(h, hdc)
        F.log(f"   [captura] {etapa}")
    except Exception as e:
        F.log(f"   [captura] {etapa}: fallo ({e})")


def limpiar_capturas_viejas():
    try:
        limite = time.time() - CAPTURAS_DIAS * 86400
        for p in CAPTURAS_DIR.glob("*.png"):
            if p.stat().st_mtime < limite:
                p.unlink()
    except Exception:
        pass


# =================== sesion con reintentos ===================
class SiapeSeCerro(RuntimeError):
    pass


_VIGIA = {"sin_ventana_desde": None, "ultimo_estado": None}
_estado_siape_base = F.estado_siape     # el ya parcheado por cargar_stress_jab (diag)


def _java_vivo():
    """Hay algun proceso Java de SiAPe corriendo (aunque no tenga ventana visible)."""
    try:
        import subprocess
        salida = subprocess.run("tasklist /FO CSV /NH", capture_output=True, text=True,
                                shell=True, timeout=15).stdout.lower()
        return any(f'"{p}"' in salida for p in PROCESOS_JAVA)
    except Exception:
        return True          # ante la duda NO lo doy por muerto


def _estado_siape_vigilado(*a, **k):
    """Igual que estado_siape, pero si el PROCESO Java de SiAPe desaparecio (no solo la
    ventana) y no vuelve en SIAPE_MUERTO_SEG corta el intento ya, en vez de esperar los
    240s enteros. Deja captura de cada cambio de pantalla."""
    if F._buscar_ventana_siape() or _java_vivo():
        _VIGIA["sin_ventana_desde"] = None
    else:
        if _VIGIA["sin_ventana_desde"] is None:
            _VIGIA["sin_ventana_desde"] = time.time()
        elif time.time() - _VIGIA["sin_ventana_desde"] >= SIAPE_MUERTO_SEG:
            capturar("siape_se_cerro")
            raise SiapeSeCerro(f"SiAPe se cerro solo (sin proceso Java hace {SIAPE_MUERTO_SEG}s).")
    estado = _estado_siape_base(*a, **k)
    if estado != _VIGIA["ultimo_estado"]:
        _VIGIA["ultimo_estado"] = estado
        capturar(f"estado_{estado}")
    return estado


F.estado_siape = _estado_siape_vigilado


# Login por variantes. El login de stress, despues del click JAB a INGRESAR, aprieta
# Enter FISICO: si SiAPe esta al frente (alguien mirando la pantalla) ese Enter cae en
# el selector que ya aparecio y lo CIERRA. Desatendido (4:40) el Enter se pierde en otra
# ventana y anda. Variante 1 = sin Enter fisico; variante 2 (si la 1 no entro) = con Enter.
_login_original = F._hacer_login     # SJ._login_robusto
_LOGIN_VARIANTE = {"n": 0}


class _SinEnter:
    """Proxy de pyautogui que ignora press('enter') y deja pasar todo lo demas."""

    def __init__(self, real):
        self._real = real

    def press(self, *a, **k):
        teclas = a[0] if a else k.get("keys")
        if isinstance(teclas, str) and teclas.lower() in ("enter", "return"):
            return None
        return self._real.press(*a, **k)

    def __getattr__(self, nombre):
        return getattr(self._real, nombre)


def _login_por_variantes():
    n = _LOGIN_VARIANTE["n"]
    _LOGIN_VARIANTE["n"] += 1
    if n == 0:
        F.log("Login variante 1: INGRESAR solo por JAB (sin Enter fisico).")
        real = SJ.pyautogui
        SJ.pyautogui = _SinEnter(real)
        try:
            return _login_original()
        finally:
            SJ.pyautogui = real
    if n == 1:
        F.log("Login variante 2: la 1 no entro -> INGRESAR por JAB + Enter fisico.")
        SJ._LOGIN_STATE["intentado"] = False
        return _login_original()
    raise RuntimeError("Login: probe las 2 variantes y SiAPe sigue en la pantalla de login.")


F._hacer_login = _login_por_variantes


def _reset_intento():
    """Deja todo como para arrancar de cero: Java cerrado, driver JAB nuevo, login
    habilitado otra vez (el login de stress hace UN intento por proceso)."""
    try:
        F.cerrar_siape()
    except Exception as e:
        F.log(f"AVISO: no pude cerrar SiAPe: {e}")
    try:
        F._jab_reset_driver()
    except Exception:
        pass
    SJ._LOGIN_STATE["intentado"] = False
    _LOGIN_VARIANTE["n"] = 0
    _VIGIA.update(sin_ventana_desde=None, ultimo_estado=None)
    time.sleep(3)


def asegurar_sesion_con_reintentos(intentos=SESION_INTENTOS):
    """Etapas 1-4 (abrir SiAPe, login, selector, eRreH) con hasta `intentos`
    arranques completos. Cada falla deja captura y motivo en el log."""
    ultimo_error = None
    for n in range(1, intentos + 1):
        F.log(f"--- Sesion SIAPE: intento {n}/{intentos} ---")
        try:
            F.asegurar_sesion(timeout=SESION_TIMEOUT_INTENTO)
            capturar("sesion_lista")
            return
        except Exception as e:
            ultimo_error = e
            F.log(f"Intento {n} de sesion fallo: {e}")
            capturar(f"sesion_fallo_{n}")
            if n < intentos:
                F.log("Cierro SiAPe y vuelvo a arrancar de cero...")
                _reset_intento()
    raise RuntimeError(f"{intentos} intentos de sesion fallaron. Ultimo: {ultimo_error}")


def siape_vivo():
    return F._buscar_ventana_siape() is not None


def _norm(t):
    """Compara nombres sin acentos/mayusculas/espacios dobles (JAB a veces
    devuelve los acentos raros)."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.lower().split())


def calcular_periodo(hoy=None):
    """Desde = dia 1 del MES ANTERIOR (para no perder lo cargado tarde del mes que
    cerro; en enero = 01/12 del anio anterior). Hasta = 31/12 del anio en curso, salvo
    octubre/noviembre/diciembre, donde se extiende a febrero/marzo/abril del
    anio siguiente (para no quedar con una ventana muy corta a fin de anio)."""
    hoy = hoy or date.today()
    desde = date(hoy.year - 1, 12, 1) if hoy.month == 1 else date(hoy.year, hoy.month - 1, 1)
    if hoy.month <= 9:
        hasta = date(hoy.year, 12, 31)
    else:
        mes_hasta = {10: 2, 11: 3, 12: 4}[hoy.month]
        anio_hasta = hoy.year + 1
        bisiesto = anio_hasta % 4 == 0 and (anio_hasta % 100 != 0 or anio_hasta % 400 == 0)
        ultimo_dia = {2: 29 if bisiesto else 28, 3: 31, 4: 30}[mes_hasta]
        hasta = date(anio_hasta, mes_hasta, ultimo_dia)
    return desde.strftime("%d/%m/%Y"), hasta.strftime("%d/%m/%Y")


def periodo_para(cfg, args):
    """(desde, hasta) para el modal PERIODO; --desde/--hasta pisan lo calculado."""
    if args.desde and args.hasta:
        return args.desde, args.hasta
    if cfg.get("periodo") == "anio":
        y = date.today().year
        return f"01/01/{y}", f"31/12/{y}"
    return calcular_periodo()


def fecha_para(cfg, args):
    """Fecha para el modal FECHA; --fecha pisa a hoy."""
    return args.fecha or date.today().strftime("%d/%m/%Y")


def _abrir_gestor_por_jab():
    """METODO A: accion JAB pura sobre el item "Consultas a Exportar" (sin abrir el
    menu, sin teclado ni coordenadas -> no depende de que SiAPe este al frente).
    Misma tecnica que abrir_ta() del robot de stress."""
    F.log("Metodo A (JAB): accion directa sobre Exportaciones -> Consultas a Exportar...")
    for el, _d, info in F._jab_walk(max_depth=14, max_segundos=15):
        if info.get("role") != "menu item":
            continue
        if not (info.get("name") or "").startswith("Consultas a Exportar"):
            continue
        for sim in (False, True):
            try:
                el.click(simulate=sim)
                return True
            except TypeError:
                try:
                    el.click()
                    return True
                except Exception:
                    pass
            except Exception:
                continue
        return False
    F.log("Metodo A (JAB): no encontre el item 'Consultas a Exportar'.")
    return False


def abrir_gestor_exportaciones(timeout=20, vueltas=2):
    frame, info = F._jab_find_frame("Gestor de Exportaciones", timeout=15, max_segundos=15)
    if frame:
        F.log("Gestor de Exportaciones ya estaba abierto, lo reuso.")
        return frame, info

    # Si un metodo no lo trae, prueba con el otro; y repite la tanda.
    for vuelta in range(1, vueltas + 1):
        if vuelta > 1:
            F.log(f"Gestor no aparecio: vuelta {vuelta}/{vueltas}.")
            F.cerrar_modales()
            _forzar_frente_seguro()
            time.sleep(0.5)
        if _abrir_gestor_por_jab():
            frame, info = F._jab_wait_frame("Gestor de Exportaciones", timeout=timeout)
            if frame:
                return frame, info
            F.log("Metodo A (JAB) no abrio el gestor; pruebo por teclado.")
        _forzar_frente_seguro()
        time.sleep(0.3)
        frame, info = _abrir_gestor_por_teclado(timeout)
        if frame:
            return frame, info
    return None, None


def _abrir_gestor_por_teclado(timeout=20):
    """METODO B: navegacion por teclado (necesita SiAPe al frente)."""
    F.log("Metodo B: navego por teclado: Exportaciones -> Consultas a Exportar...")
    pyautogui.press("escape")
    time.sleep(0.3)
    pyautogui.press("alt")
    time.sleep(0.4)
    # SIAPE -> MiLegajo -> Personas -> Estructuras -> Hospitales -> Cargos ->
    # Autorizante -> Novedades -> Rec.Medicos -> Autoseguro -> Exportaciones = 10 saltos
    for _ in range(10):
        pyautogui.press("right")
        time.sleep(0.12)
    time.sleep(0.3)
    pyautogui.press("down")
    time.sleep(0.6)
    pyautogui.press("c")  # mnemonico de "Consultas a Exportar"
    return F._jab_wait_frame("Gestor de Exportaciones", timeout=timeout)


def fila_consulta(nombre_consulta, nro=None, timeout=20):
    """Busca la fila por "NOMBRE DE LA CONSULTA" y devuelve (elemento, info, aviso). OJO: en la
    grilla el NAME JAB de cada celda es el titulo de la columna; el valor esta en el
    texto. El NRO solo se usa como CONFIRMACION: el 05/10 JAB devolvio los numeros
    corridos una fila y buscar por nro abrio "Novedades Rechazadas" (79) en vez de
    "Novedades Por Periodo" (4). Si no coincide se avisa, pero manda el nombre."""
    objetivo = _norm(nombre_consulta)
    limite = time.time() + timeout
    while time.time() < limite:
        fila, el_fila, nros = None, None, []
        for el, _depth, info in F._jab_walk(max_depth=24, max_segundos=10):
            if info.get("role") != "text":
                continue
            b = info.get("bounds") or {}
            if (b.get("y") or -1) < 250:
                continue
            columna = " ".join((info.get("name") or "").split())
            if columna == "NOMBRE DE LA CONSULTA" and fila is None:
                if _norm(F._jab_read_text(el)) == objetivo:
                    fila, el_fila = info, el
            elif columna == "NRO. DE CONSULTA":
                nros.append((b.get("y"), (F._jab_read_text(el) or "").strip()))
        if fila:
            y = (fila.get("bounds") or {}).get("y")
            leido = next((t for yy, t in nros if yy is not None and y is not None and abs(yy - y) <= 3), None)
            aviso = None
            if nro is not None and leido != str(nro):
                aviso = f"en la fila de '{nombre_consulta}' JAB lee nro {leido!r} (esperaba {nro})"
            return el_fila, fila, aviso
        time.sleep(1)
    return None, None, None


def fila_enfocada(y, nombre_consulta, timeout=6):
    """True si la celda con foco es la de NOMBRE a la altura y (la fila elegida)."""
    for el, _d, info in F._jab_walk(max_depth=24, max_segundos=timeout):
        if "enfocado" not in (info.get("states") or []) or info.get("role") != "text":
            continue
        b = info.get("bounds") or {}
        return abs((b.get("y") or -999) - y) <= 3
    return False


def seleccionar_fila(el_fila, info_fila, nombre_consulta):
    """Exportar exporta el REGISTRO SELECCIONADO (no la fila del boton): la fila se
    selecciona por JAB (requestFocus, sin coordenadas) y se verifica. Si no, click
    con la escala calibrada y se verifica otra vez."""
    y = (info_fila.get("bounds") or {}).get("y")
    try:
        el_fila._request_focus()
        time.sleep(0.8)
        if fila_enfocada(y, nombre_consulta):
            F.log("Fila seleccionada por JAB (foco verificado).")
            return True
        F.log("AVISO: el foco JAB no quedo en la fila; pruebo click.")
    except Exception as e:
        F.log(f"AVISO: requestFocus fallo ({e}); pruebo click.")
    F._jab_click_bounds(info_fila)
    time.sleep(0.8)
    if fila_enfocada(y, nombre_consulta):
        F.log("Fila seleccionada por click (foco verificado).")
        return True
    return False


def modal_esperado(cfg):
    """Que modal tiene que abrir la consulta: PERIODO, FECHA o None (sin fechas)."""
    p = cfg.get("periodo")
    if p in ("mes_a_fin", "anio"):
        return "PERIODO"
    if p == "hoy":
        return "FECHA"
    return None


def cancelar_modal():
    try:
        el, info = F._jab_buscar(empieza="CANCELAR", role="push button", timeout=3)
        if info:
            if not (el is not None and _accion_jab(el)):
                F._jab_click_bounds(info)
            time.sleep(1)
    except Exception:
        pass


def boton_exportar_en(y, tol=6, timeout=10):
    """(elemento JAB, bounds) del boton Exportar a la altura de la fila."""
    el, info = F._jab_buscar(nombre="Exportar", role="push button", timeout=timeout,
                             y_min=y - tol, y_max=y + tol)
    return (el, info.get("bounds")) if info else (None, None)


def _accion_jab(el):
    """Accion JAB pura (sin mouse ni coordenadas: no la afecta la escala/offset
    de los clicks ni que SiAPe este al frente). True si se pudo ejecutar."""
    try:
        el.click(simulate=False)
        return True
    except TypeError:
        try:
            el.click()
            return True
        except Exception:
            return False
    except Exception:
        return False


def clickear_exportar(el, bounds, intento):
    """Intento 1: accion JAB; si no se pudo (o en el reintento), click por coordenadas."""
    if intento == 1 and el is not None and _accion_jab(el):
        F.log("Exportar: accion JAB directa.")
        return
    F.log("Exportar: click por coordenadas.")
    F._jab_click_bounds({"bounds": bounds})


def esperar_modal(timeout=10):
    """Despues de Exportar: devuelve 'PERIODO', 'FECHA' o None si no aparece
    ninguno (consultas sin parametros: Consolidado, Pendientes, ...)."""
    limite = time.time() + timeout
    while time.time() < limite:
        restante = max(2, limite - time.time())
        for _el, _d, info in F._jab_walk(max_depth=14, max_segundos=min(restante, 8)):
            if info.get("role") != "internal frame":
                continue
            n = info.get("name") or ""
            if n in ("PERIODO", "FECHA") and F._jab_visible_bounds(info):
                return n
        time.sleep(0.8)
    return None


def _tipear_en(info, valor):
    F._jab_click_bounds(info)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    time.sleep(0.2)
    pyautogui.write(valor, interval=0.04)
    time.sleep(0.3)


def completar_modal(modal, cfg, args):
    if modal == "PERIODO":
        desde, hasta = periodo_para(cfg, args)
        F.log(f"Modal PERIODO: {desde} a {hasta}")
        _, desde_info = F._jab_buscar(nombre="Fecha Desde", role="text", timeout=10)
        _, hasta_info = F._jab_buscar(nombre="Fecha Hasta", role="text", timeout=10)
        if not (desde_info and hasta_info):
            raise RuntimeError("No encontre los campos Fecha Desde / Fecha Hasta.")
        _tipear_en(desde_info, desde)
        _tipear_en(hasta_info, hasta)
    else:  # FECHA
        fecha = fecha_para(cfg, args)
        F.log(f"Modal FECHA: {fecha}")
        _, fecha_info = F._jab_buscar(nombre="Fecha", role="text", timeout=10)
        if not fecha_info:
            # el nombre JAB del campo no esta mapeado todavia: primer text "Fecha..."
            _, fecha_info = F._jab_buscar(empieza="Fecha", role="text", timeout=5)
        if not fecha_info:
            raise RuntimeError("No encontre el campo Fecha del modal FECHA.")
        _tipear_en(fecha_info, fecha)

    _, aceptar_info = F._jab_buscar(nombre="ACEPTAR Alt A", role="push button", timeout=10)
    if not aceptar_info:
        raise RuntimeError(f"No encontre el boton ACEPTAR del modal {modal}.")
    F._jab_click_bounds(aceptar_info)
    time.sleep(2)


def confirmar_dialogo_si(timeout=15):
    """True = no salio dialogo. dict = boton Si encontrado (para clickear
    afuera, con la escala correcta). None = salio dialogo pero sin boton Si."""
    texto, botones = F.leer_dialogo_jab(max_segundos=timeout)
    if not texto:
        return True
    F.log(f"Dialogo SiAPe: {texto[:200]}")
    for b in botones:
        if (b.get("name") or "").lower().startswith("si"):
            return b
    return None


def esperar_descarga(desde_ts, timeout=300, poll=3, excluir=()):
    """Espera un archivo reporte_*.xlsx nuevo (mtime >= desde_ts) en Descargas.
    `excluir`: archivos ya tomados por consultas anteriores de la misma corrida
    (--all), para no copiar dos veces el mismo. Espera a que el tamanio se
    estabilice (Chrome termina de escribir)."""
    excluir = {Path(e).resolve() for e in excluir}
    limite = time.time() + timeout
    while time.time() < limite:
        for p in sorted(DESCARGAS_DIR.glob("reporte_*.xlsx"), key=lambda p: p.stat().st_mtime, reverse=True):
            if p.resolve() in excluir or p.stat().st_mtime < desde_ts:
                continue
            tam = -1
            while tam != p.stat().st_size:
                tam = p.stat().st_size
                time.sleep(1.5)
            if tam > 0:
                return p
        time.sleep(poll)
    return None


def registrar_resultado(script_id, descripcion, estado, motivo=None, filas=None, archivo=None, duracion_seg=None):
    try:
        with F.conn() as cn, cn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS script_runs (
                  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                  script VARCHAR(120) NOT NULL,
                  descripcion VARCHAR(255) NULL,
                  estado ENUM('ok','error') NOT NULL,
                  motivo VARCHAR(500) NULL,
                  filas INT NULL,
                  archivo VARCHAR(500) NULL,
                  duracion_seg INT NULL,
                  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (id),
                  KEY idx_script_runs__script_fecha (script, actualizado_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
            cur.execute(
                "INSERT INTO script_runs (script, descripcion, estado, motivo, filas, archivo, duracion_seg) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (script_id, descripcion, estado, (motivo or "")[:500] or None, filas,
                 str(archivo) if archivo else None, duracion_seg),
            )
            cn.commit()
    except Exception as e:
        F.log(f"AVISO: no pude registrar el resultado en script_runs: {e}")


def descargar_con_reintentos(nombre, args, ya_bajados):
    """Etapas 5-7 con reintento: si falla, limpia pantalla y prueba de nuevo; si en el
    medio SiAPe se murio, rearma la sesion entera antes del reintento."""
    for n in range(1, CONSULTA_INTENTOS + 1):
        ultimo = n == CONSULTA_INTENTOS
        if descargar_una(nombre, args, ya_bajados, registrar_error=ultimo):
            return True
        capturar(f"consulta_fallo_{_norm(nombre).replace(' ', '_')}_{n}")
        if ultimo:
            return False
        F.log(f"Reintento '{nombre}' ({n + 1}/{CONSULTA_INTENTOS})...")
        if not siape_vivo():
            F.log("SiAPe ya no esta abierto: rearmo la sesion.")
            try:
                _reset_intento()
                asegurar_sesion_con_reintentos()
            except Exception as e:
                F.log(f"No pude rearmar la sesion: {e}")
                cfg = CONSULTAS[nombre]
                registrar_resultado(cfg["script_id"], cfg["descripcion"], "error",
                                    motivo=f"SiAPe se cerro y no pude rearmar la sesion: {e}")
                return False
    return False


def descargar_una(nombre, args, ya_bajados, registrar_error=True):
    cfg = CONSULTAS[nombre]
    t0 = time.time()
    F.log(f"===== {nombre} =====")
    try:
        F.cerrar_modales()
        _forzar_frente_seguro()  # despues de cada descarga Chrome puede quedar al frente
        time.sleep(0.3)

        frame, _info = abrir_gestor_exportaciones()
        if not frame:
            raise RuntimeError("No pude abrir Gestor de Exportaciones.")

        el_fila, info_fila, aviso_nro = fila_consulta(nombre, cfg.get("nro"))
        if not info_fila:
            raise RuntimeError(f"No encontre la consulta '{nombre}' en la grilla.")
        F.log(f"Fila ubicada por nombre (y={(info_fila.get('bounds') or {}).get('y')}).")
        if aviso_nro:
            F.log(f"AVISO: {aviso_nro}; sigo por nombre.")

        # NO usar `_jab_click_bounds_verificado`: en la grilla el name JAB de las celdas
        # es el titulo de la columna, nunca coincide y "autocalibraba" mal los clicks.
        if not seleccionar_fila(el_fila, info_fila, nombre):
            capturar("fila_no_seleccionada")
            raise RuntimeError(f"No pude seleccionar la fila '{nombre}' (Exportar exporta la fila seleccionada).")

        b_fila = info_fila.get("bounds") or {}
        el_exportar, b_exportar = boton_exportar_en(b_fila["y"])
        if not b_exportar:
            raise RuntimeError("No encontre el boton Exportar de la fila.")

        # El modal tiene que ser el de ESTA consulta: si aparece otro, se abrio la
        # consulta equivocada -> CANCELAR y error (no se pisa el archivo destino).
        # Si lleva fechas y no aparece ninguno, el click no llego al boton: se
        # reintenta una vez y si no, error enseguida (no 300s de espera).
        esperado = modal_esperado(cfg)
        modal = None
        for intento in (1, 2):
            t_click = time.time()
            clickear_exportar(el_exportar, b_exportar, intento)
            time.sleep(1.2)
            modal = esperar_modal(timeout=10)
            if modal != esperado:
                if modal:
                    capturar("modal_equivocado")
                    cancelar_modal()
                    raise RuntimeError(f"Abrio la consulta equivocada: aparecio el modal {modal} "
                                       f"y '{nombre}' lleva {esperado or 'ninguno'}. Cancelado.")
            if modal or not esperado:
                break
            F.log(f"Exportar (intento {intento}) no abrio el modal {esperado}.")
            capturar(f"exportar_sin_modal_{intento}")
        if esperado and not modal:
            raise RuntimeError(f"El click en Exportar no abrio el modal {esperado} (2 intentos).")
        if modal:
            completar_modal(modal, cfg, args)
        else:
            F.log("Sin modal de fechas (consulta sin parametros).")

        resultado = confirmar_dialogo_si()
        if resultado is None:
            raise RuntimeError("Aparecio un dialogo de confirmacion pero no encontre el boton Si.")
        if resultado is not True:
            F._jab_click_bounds(resultado)
            time.sleep(1)

        F.log("Esperando la descarga en Chrome (puede tardar si la red esta lenta)...")
        archivo = esperar_descarga(t_click, timeout=args.timeout_descarga, excluir=ya_bajados)
        if not archivo:
            raise RuntimeError(
                f"No aparecio ningun reporte_*.xlsx nuevo en Descargas dentro de {args.timeout_descarga}s."
            )
        ya_bajados.append(archivo)
        F.log(f"Descarga OK: {archivo.name} ({archivo.stat().st_size} bytes)")

        cfg["destino_dir"].mkdir(parents=True, exist_ok=True)
        destino = cfg["destino_dir"] / cfg["destino_nombre"]
        shutil.copyfile(archivo, destino)
        F.log(f"Copiado a {destino}")

        duracion = int(time.time() - t0)
        registrar_resultado(cfg["script_id"], cfg["descripcion"], "ok", archivo=destino, duracion_seg=duracion)
        F.log(f"OK ({duracion}s).")
        return True

    except Exception as e:
        duracion = int(time.time() - t0)
        F.log(f"ERROR [{nombre}]: {e}")
        if registrar_error:
            registrar_resultado(cfg["script_id"], cfg["descripcion"], "error", motivo=str(e), duracion_seg=duracion)
        # deja la pantalla limpia para la siguiente consulta (modal a medio llenar)
        try:
            cancelar_modal()
            F.cerrar_modales()
        except Exception:
            pass
        return False


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--consulta", choices=list(CONSULTAS.keys()))
    g.add_argument("--all", action="store_true", help="Baja las 9 consultas en orden")
    ap.add_argument("--desde", help="DD/MM/AAAA para modal PERIODO (si no, se calcula)")
    ap.add_argument("--hasta", help="DD/MM/AAAA para modal PERIODO (si no, se calcula)")
    ap.add_argument("--fecha", help="DD/MM/AAAA para modal FECHA (si no, hoy)")
    ap.add_argument("--timeout-descarga", type=int, default=300)
    args = ap.parse_args()

    nombres = list(CONSULTAS.keys()) if args.all else [args.consulta]

    limpiar_capturas_viejas()
    try:
        asegurar_sesion_con_reintentos()
    except Exception as e:
        F.log(f"ERROR: no pude asegurar la sesion de SIAPE: {e}")
        for n in nombres:
            cfg = CONSULTAS[n]
            registrar_resultado(cfg["script_id"], cfg["descripcion"], "error", motivo=f"sesion: {e}")
        return 1

    ya_bajados = []
    fallas = [n for n in nombres if not descargar_con_reintentos(n, args, ya_bajados)]
    F.log(f"Fin: {len(nombres) - len(fallas)}/{len(nombres)} OK"
          + (f" - fallaron: {fallas}" if fallas else ""))
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
