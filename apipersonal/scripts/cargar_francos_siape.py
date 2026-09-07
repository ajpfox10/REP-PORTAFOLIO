"""
Carga en SiAPe (Oracle Forms) los francos compensatorios pendientes
de personalv5.reconocimientos_medicos.

Regla de negocio (definida con el usuario):
  - Todo lo pendiente (procesado=0) se carga como compensatorio en SiAPe,
    sin importar el `tipo` de la tabla (enfermedad, PI, FLIAR, etc.).
  - Flujo default: pestaña COMPENSATORIOS, tipo SIAPE_COMP_TIPO
    (por defecto HORA COMPENSADA).
  - Flujo legacy: Ausencias Eventuales, FRANCO COMPENSATORIO (COMUNICACIONES).
  - En la tabla el registro es un RANGO (fecha_desde..fecha_hasta); en SiAPe se carga
    un dia por vez (dias CORRIDOS, incluyendo fines de semana).
  - PARTIDO queda vacio. JUSTIFICADO siempre tildado.
  - Si SiAPe avisa "Ya existe una ausencia eventual para el dia X" -> ese dia NO se carga
    y se registra en la columna errores_carga.
  - Al terminar todos los dias de un registro -> procesado=1 (aunque no se haya cargado
    ninguno porque ya existian).

REQUISITOS:
    pip install pyautogui pygetwindow
    Configurar SIAPE_USER y SIAPE_PASS en .env.
    Si SiAPe no esta abierto, configurar SIAPE_EXE_PATH o SIAPE_START_CMD.
    Flujo principal: SIAPE_FLOW=compensatorios (default), usando el mapeo
    Novedades -> Ficheros -> NOVEDADES -> COMPENSATORIOS.
    Horas configurables:
      SIAPE_COMP_CANT_HORAS=8
      SIAPE_COMP_HORA_DESDE=08:00
      SIAPE_COMP_HORA_HASTA=16:00
    Flujo viejo por Ausencias Eventuales: SIAPE_FLOW=legacy_ausencias.

Uso:
    python cargar_francos_siape.py --dry-run          # solo muestra la cola, no toca SiAPe
    python cargar_francos_siape.py --id 7             # un registro puntual
    python cargar_francos_siape.py --limit 1          # el primer pendiente
    python cargar_francos_siape.py                    # toda la cola
"""

import argparse
import os
import subprocess
import sys
import time
from collections import deque
from datetime import date, timedelta
from pathlib import Path

import pymysql

try:
    import pyautogui
except ImportError:
    pyautogui = None

# CONFIG


def load_dotenv():
    """Carga .env local sin dependencia externa; no pisa variables ya heredadas."""
    candidates = [
        Path(__file__).resolve().parents[1] / ".env",
        Path.cwd() / ".env",
    ]
    for fp in candidates:
        if not fp.exists():
            continue
        try:
            for raw in fp.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and os.environ.get(key, "") == "":
                    os.environ[key] = value
        except Exception as e:
            print(f"AVISO: no se pudo leer {fp}: {e}")


load_dotenv()


DB = dict(
    host=os.environ.get("DB_HOST", "127.0.0.1"),
    port=int(os.environ.get("DB_PORT", 3306)),
    user=os.environ.get("DB_USER", "root"),
    password=os.environ.get("DB_PASSWORD", ""),
    database=os.environ.get("DB_NAME", "personalv5"),
    charset="utf8mb4",
)

VENTANA_SIAPE = "Sistema Unico Provincial de Administracion de Personal"
TIPO_AUSENCIA = "FRANCO COMPENSATORIO (COMUNICACIONES)"
SIAPE_USER = os.environ.get("SIAPE_USER", "").strip()
SIAPE_PASS = os.environ.get("SIAPE_PASS", "").strip()
SIAPE_EXE_PATH = os.environ.get("SIAPE_EXE_PATH", "").strip()
SIAPE_START_CMD = os.environ.get("SIAPE_START_CMD", "").strip()
SIAPE_LOGIN_MODE = os.environ.get("SIAPE_LOGIN_MODE", "tab").strip().lower()
SIAPE_OPEN_TIMEOUT = int(os.environ.get("SIAPE_OPEN_TIMEOUT", "60") or "60")
SIAPE_POST_LOGIN_SECONDS = float(os.environ.get("SIAPE_POST_LOGIN_SECONDS", "4") or "4")
SIAPE_ENTER_ERREH = os.environ.get("SIAPE_ENTER_ERREH", "true").strip().lower() not in ("0", "false", "no")
SIAPE_ERREH_WAIT_SECONDS = float(os.environ.get("SIAPE_ERREH_WAIT_SECONDS", "6") or "6")
SIAPE_ERREH_WAIT_MENU_SECONDS = float(os.environ.get("SIAPE_ERREH_WAIT_MENU_SECONDS", "20") or "20")
SIAPE_USE_JAB = os.environ.get("SIAPE_USE_JAB", "true").strip().lower() not in ("0", "false", "no")
SIAPE_FLOW = os.environ.get("SIAPE_FLOW", "agente_ausencias").strip().lower()
SIAPE_COMP_TIPO = os.environ.get("SIAPE_COMP_TIPO", "HORA COMPENSADA").strip()
SIAPE_COMP_CANT_HORAS = os.environ.get("SIAPE_COMP_CANT_HORAS", "8").strip()
SIAPE_COMP_HORA_DESDE = os.environ.get("SIAPE_COMP_HORA_DESDE", "08:00").strip()
SIAPE_COMP_HORA_HASTA = os.environ.get("SIAPE_COMP_HORA_HASTA", "16:00").strip()
SIAPE_JAB_SCALE = float(os.environ.get("SIAPE_JAB_SCALE", "1.5") or "1.5")
SIAPE_PYAUTOGUI_FAILSAFE = os.environ.get("SIAPE_PYAUTOGUI_FAILSAFE", "false").strip().lower() in (
    "1",
    "true",
    "si",
    "sí",
    "yes",
)
SIAPE_ERREH_TEMPLATE = os.environ.get(
    "SIAPE_ERREH_TEMPLATE",
    str(Path(__file__).with_name("siape_erreh.png")),
).strip()

# Pausas (Oracle Forms es lento; subir si el server responde despacio)
PAUSA_CORTA = 0.4
PAUSA_MEDIA = 1.0
PAUSA_LARGA = 2.5

# Techo duro para cualquier espera. Sin esto, los "timeout" nominales de los
# helpers JAB se vuelven eternos porque cada vuelta recorre el arbol entero.
SIAPE_PASO_TIMEOUT = float(os.environ.get("SIAPE_PASO_TIMEOUT", "90") or "90")


# LOG

_LOG_FH = None
_T0 = time.time()


def log(msg=""):
    """Todo lo que imprime el script pasa por aca: con hora y segundos desde el arranque."""
    linea = f"[{time.strftime('%H:%M:%S')} +{time.time() - _T0:6.1f}s] {msg}"
    print(linea, flush=True)
    if _LOG_FH is not None:
        try:
            _LOG_FH.write(linea + "\n")
            _LOG_FH.flush()
        except Exception:
            pass

# Coordenadas relativas al AREA CLIENTE de la ventana del SiAPe.
# Se calibran con --calibrar. Guardadas segun la captura de referencia (1456x816).
COORD = {
    "btn_agregar":      (82, 71),     # + verde de la toolbar
    "btn_guardar":      (16, 71),     # disquete de la toolbar
    "btn_borrar":       (107, 71),    # X roja: descarta el registro en edicion
    "combo_tipo":       (240, 243),   # cuerpo del combo TIPO DE AUSENCIA
    "campo_fecha":      (492, 243),
    "check_justificado": (461, 305),  # CALIBRADO: hay que clickearlo, Tab no llega
    "btn_puntos_legajo": (875, 146),  # "..." que abre el Buscador de Persona
    # Buscador de Persona (modal)
    "radio_cuil":       (736, 187),
    "input_busqueda":   (676, 231),
    "btn_buscar":       (1079, 230),
    "primera_fila":     (578, 318),
    "btn_aceptar":      (907, 614),
    # Botones de dialogos (posicion observada en vivo)
    "dlg_continuar":    (881, 517),   # Advertencia "Ya existe..."
    "dlg_si":           (836, 517),   # "¿Esta seguro que desea Borrar los datos?" -> Si
}

# Coordenadas absolutas de la pantalla "Novedades de Ausentismo" del agente,
# calibradas sobre SiAPe maximizado (1920x1080). Son fallback cuando Oracle Forms
# no expone los campos internos por Java Access Bridge.
AGENTE_AUSENCIAS_POS = {
    "tab_ausencias": (432, 793),
    "btn_agregar": (117, 105),
    "btn_guardar": (36, 105),
    "combo_tipo": (330, 330),
    "campo_fecha": (661, 330),
    "check_justificado": (621, 410),
    "menu_novedades": (735, 64),
    "menu_novedades_ausentismo": (250, 128),
    "volver_ficheros": (1387, 1008),
}

# LOGIN SIAPE


def _coord_env(nombre):
    raw = os.environ.get(nombre, "").strip()
    if not raw:
        return None
    try:
        x, y = raw.replace(";", ",").split(",", 1)
        return int(x.strip()), int(y.strip())
    except Exception:
        print(f"AVISO: {nombre} invalido. Usar formato x,y")
        return None


def _buscar_ventana_siape():
    import pygetwindow as gw

    wins = [w for w in gw.getAllWindows() if VENTANA_SIAPE.lower() in (w.title or "").lower()]
    return wins[0] if wins else None


def _forzar_foreground(hwnd):
    """
    Trae la ventana al frente de verdad.

    Windows le niega SetForegroundWindow a un proceso que no tiene el foco
    (por eso fallaban pygetwindow y win32gui a secas, y todo lo que tipeaba
    pyautogui terminaba en otra ventana). El truco es engancharse al hilo de
    la ventana que hoy esta en primer plano con AttachThreadInput.
    """
    import ctypes

    import win32con
    import win32gui

    u = ctypes.windll.user32
    k = ctypes.windll.kernel32
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        fg = u.GetForegroundWindow()
        if fg == hwnd:
            return True
        # Windows bloquea el cambio de foco salvo que haya "input del usuario"
        # reciente: se destraba bajando el lock timeout y simulando un ALT.
        try:
            u.SystemParametersInfoW(0x2001, 0, 0, 0)      # SPI_SETFOREGROUNDLOCKTIMEOUT = 0
        except Exception:
            pass
        u.keybd_event(0x12, 0, 0, 0)                      # ALT abajo
        u.keybd_event(0x12, 0, 2, 0)                      # ALT arriba

        tid_fg = u.GetWindowThreadProcessId(fg, None)
        tid_me = k.GetCurrentThreadId()
        enganchado = u.AttachThreadInput(tid_me, tid_fg, True)
        try:
            u.BringWindowToTop(hwnd)
            u.SetForegroundWindow(hwnd)
            u.SetActiveWindow(hwnd)
        finally:
            if enganchado:
                u.AttachThreadInput(tid_me, tid_fg, False)
        time.sleep(PAUSA_CORTA)
        if u.GetForegroundWindow() == hwnd:
            return True

        # ultimo recurso: minimizar y restaurar suele devolver el foco
        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        time.sleep(PAUSA_CORTA)
        return u.GetForegroundWindow() == hwnd
    except Exception as e:
        log(f"AVISO: no pude forzar foreground: {e}")
        return False


def _activar_ventana(w):
    if w is None:
        raise RuntimeError(f"No encuentro la ventana '{VENTANA_SIAPE}'.")
    if w.isMinimized:
        try:
            w.restore()
        except Exception:
            pass
    hwnd = getattr(w, "_hWnd", None)
    if not (hwnd and _forzar_foreground(hwnd)):
        try:
            w.activate()
        except Exception as e:
            log(f"AVISO: SiAPe no quedo al frente ({e}); sigo igual.")
    time.sleep(PAUSA_CORTA)
    return w.left, w.top


def abrir_siape_si_falta():
    w = _buscar_ventana_siape()
    if w:
        return _activar_ventana(w)

    if SIAPE_START_CMD:
        print("No encontre SiAPe abierto. Ejecutando SIAPE_START_CMD...")
        subprocess.Popen(SIAPE_START_CMD, shell=True)
    elif SIAPE_EXE_PATH:
        print("No encontre SiAPe abierto. Ejecutando SIAPE_EXE_PATH...")
        subprocess.Popen([SIAPE_EXE_PATH], shell=False)
    else:
        raise RuntimeError(
            f"No encuentro la ventana '{VENTANA_SIAPE}' y no esta configurado "
            "SIAPE_EXE_PATH ni SIAPE_START_CMD."
        )

    deadline = time.time() + SIAPE_OPEN_TIMEOUT
    while time.time() < deadline:
        w = _buscar_ventana_siape()
        if w:
            return _activar_ventana(w)
        time.sleep(1)
    raise RuntimeError(f"SiAPe no abrio dentro de {SIAPE_OPEN_TIMEOUT} segundos.")


def _pegar_texto(texto):
    try:
        import pyperclip

        pyperclip.copy(texto)
        pyautogui.hotkey("ctrl", "v")
    except Exception:
        pyautogui.write(texto, interval=0.02)


_JAB_CACHE = {"drv": None}


def _jab_driver(timeout=8, forzar=False):
    """
    Devuelve el JABDriver, cacheado.

    Antes cada helper creaba uno nuevo (varios por campo cargado): eso es lento,
    filtra handles y es la razon principal de que el script pareciera colgado.
    """
    if not SIAPE_USE_JAB:
        return None
    if not forzar and _JAB_CACHE["drv"] is not None:
        return _JAB_CACHE["drv"]
    try:
        from pyjab.jabdriver import JABDriver

        drv = JABDriver(
            title=VENTANA_SIAPE,
            bridge_dll=r"C:\Program Files\Java\jre1.8.0_333\bin\WindowsAccessBridge-64.dll",
            timeout=timeout,
        )
        _JAB_CACHE["drv"] = drv
        return drv
    except Exception as e:
        log(f"AVISO: Java Access Bridge no disponible para SiAPe: {e}")
        _JAB_CACHE["drv"] = None
        return None


def _jab_reset_driver():
    _JAB_CACHE["drv"] = None


def _jab_click(nombre, timeout=8):
    drv = _jab_driver(timeout=timeout)
    if not drv:
        return False
    try:
        el = drv.find_element_by_name(nombre, visible=True)
        el.click()
        return True
    except Exception as e:
        print(f"AVISO: no pude clickear '{nombre}' por JAB: {e}")
        return False


def _jab_context_id(el):
    ctx = el.accessible_context
    return int(getattr(ctx, "value", ctx))


def _jab_iter_children(el):
    from pyjab.jabelement import JABElement

    for index in range(el.children_count):
        try:
            child_acc = el.bridge.getAccessibleChildFromContext(
                el.vmid, el.accessible_context, index
            )
            yield JABElement(el.bridge, el.hwnd, el.vmid, child_acc)
        except Exception:
            continue


def _banda_ok(info, banda_y):
    """True si el nodo puede contener algo de la banda vertical buscada."""
    if banda_y is None:
        return True
    b = info.get("bounds") or {}
    y, h = b.get("y"), b.get("height")
    if y is None or h is None or y < 0 or h <= 0:
        return True                      # sin bounds utiles: hay que bajar igual
    return not (y > banda_y[1] or (y + h) < banda_y[0])


def _jab_walk(max_depth=30, max_nodes=4000, root=None, timeout=10, max_segundos=None, banda_y=None):
    """
    Recorre el arbol JAB. `max_segundos` corta el recorrido aunque falten nodos:
    sin ese corte un walk podia irse minutos y hacer inutiles los timeouts de
    los que llaman.
    """
    drv = None
    if root is None:
        drv = _jab_driver(timeout=timeout)
        if not drv:
            return
        root = drv.root_element

    limite = time.time() + (max_segundos if max_segundos is not None else SIAPE_PASO_TIMEOUT)
    seen = set()
    queue = deque([(root, 0)])
    while queue and len(seen) < max_nodes:
        if time.time() > limite:
            log(f"AVISO: corto el recorrido JAB por tiempo ({len(seen)} nodos vistos).")
            return
        el, depth = queue.popleft()
        try:
            cid = _jab_context_id(el)
            if cid in seen:
                continue
            seen.add(cid)
            info = el.get_element_information()
        except Exception:
            continue
        yield el, depth, info
        # La grilla de Ficheros son cientos de celdas: si el nodo esta fuera de la
        # banda que interesa, no se baja. Es lo que hacia lento (y por lo tanto
        # inutil) cada recorrido en esa pantalla.
        if depth < max_depth and _banda_ok(info, banda_y):
            for child in _jab_iter_children(el):
                queue.append((child, depth + 1))


def _jab_visible_bounds(info):
    bounds = info.get("bounds") or {}
    states = info.get("states") or []
    return (
        "visible" in states
        and "mostrando" in states
        and (bounds.get("x", -1) or -1) >= 0
        and (bounds.get("width", 0) or 0) > 0
        and (bounds.get("height", 0) or 0) > 0
    )


def _bounds_ok(info):
    b = info.get("bounds") or {}
    return (b.get("x", -1) or -1) >= 0 and (b.get("width", 0) or 0) > 0 and (b.get("height", 0) or 0) > 0


def _jab_buscar(nombre=None, role=None, desc=None, empieza=None, timeout=None,
                banda_y=None, x_min=None, x_max=None, y_min=None, y_max=None):
    """
    Busca un elemento desde la raiz, reintentando hasta `timeout` REAL.

    Cada vuelta del walk tiene su propio corte por tiempo, asi el deadline se
    cumple de verdad (antes un solo recorrido podia comerse todo el timeout).
    """
    limite = time.time() + (timeout if timeout is not None else SIAPE_PASO_TIMEOUT)
    while True:
        restante = limite - time.time()
        if restante <= 0:
            return None, None
        for _el, _depth, info in _jab_walk(max_depth=25, max_segundos=min(restante, 20),
                                           banda_y=banda_y):
            if role is not None and info.get("role") != role:
                continue
            b = info.get("bounds") or {}
            if x_min is not None and (b.get("x", -1) or -1) < x_min:
                continue
            if x_max is not None and (b.get("x", 10 ** 6) or 0) > x_max:
                continue
            if y_min is not None and (b.get("y", -1) or -1) < y_min:
                continue
            if y_max is not None and (b.get("y", 10 ** 6) or 0) > y_max:
                continue
            n = info.get("name") or ""
            if nombre is not None and n != nombre:
                continue
            if empieza is not None and not n.startswith(empieza):
                continue
            if desc is not None and (info.get("description") or "") != desc:
                continue
            if not _bounds_ok(info):
                continue
            return _el, info
        time.sleep(0.6)


# ESTADO DE LA SESION

ESTADO_LOGIN = "login"
ESTADO_SELECTOR = "selector"     # pantalla "Ingreso a SIAPE" con los modulos (eRreH, HHEE...)
ESTADO_ERREH = "erreh"           # ya adentro de eRreH, con la barra de menu
ESTADO_DESCONOCIDO = "desconocido"


def estado_siape(max_segundos=20):
    """Mira el arbol JAB una sola vez y dice en que pantalla esta SiAPe."""
    visto = set()
    for _el, _depth, info in _jab_walk(max_depth=25, max_segundos=max_segundos):
        if not _bounds_ok(info):
            continue
        visto.add(((info.get("role") or ""), (info.get("name") or "")))
    if ("push button", "INGRESAR") in visto:
        return ESTADO_LOGIN
    if ("push button", "RRHH") in visto:
        return ESTADO_SELECTOR
    if any(rol == "menu" and nom.startswith("Novedades") for rol, nom in visto):
        return ESTADO_ERREH
    return ESTADO_DESCONOCIDO


def _escribir_en_campo(info, texto):
    """Click en el campo por bounds y tipeo. Oracle Forms no acepta setTextContents."""
    _jab_click_bounds(info)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    time.sleep(0.2)
    pyautogui.write(str(texto), interval=0.05)
    time.sleep(PAUSA_CORTA)


def _hacer_login():
    """Login por JAB+tipeo. `find_element_by_name(visible=True)` de pyjab no sirve aca."""
    if not SIAPE_USER or not SIAPE_PASS:
        raise RuntimeError("Falta SIAPE_USER o SIAPE_PASS en .env.")
    _, usr = _jab_buscar(nombre="Usuario", role="text", timeout=20)
    _, pwd = _jab_buscar(role="password text", timeout=20)
    _, btn = _jab_buscar(nombre="INGRESAR", role="push button", timeout=20)
    if not (usr and pwd and btn):
        raise RuntimeError("Estoy en la pantalla de login pero no encuentro Usuario/Contraseña/INGRESAR.")
    log(f"Logueando como {SIAPE_USER}...")
    _escribir_en_campo(usr, SIAPE_USER)
    _escribir_en_campo(pwd, SIAPE_PASS)
    _jab_click_bounds(btn)


def _entrar_erreh():
    _, btn = _jab_buscar(nombre="RRHH", role="push button", timeout=20)
    if not btn:
        raise RuntimeError("No encuentro el modulo eRreH en el selector de SIAPE.")
    log("Entrando a eRreH...")
    _jab_click_bounds(btn)


def asegurar_sesion(timeout=None):
    """
    Deja SiAPe adentro de eRreH, arranque donde arranque.

    Es el reemplazo de login_siape()+entrar_erreh_si_corresponde(): en vez de
    asumir sesion abierta (SIAPE_SKIP_LOGIN) y clickear coordenadas a ciegas,
    mira el estado real en cada vuelta y actua en consecuencia.
    """
    limite = time.time() + (timeout if timeout is not None else float(
        os.environ.get("SIAPE_SESION_TIMEOUT", "240") or "240"))
    if not _buscar_ventana_siape():
        abrir_siape_si_falta()
    _activar_ventana(_buscar_ventana_siape())
    desconocidos = 0
    ultimo = None
    while time.time() < limite:
        estado = estado_siape()
        if estado != ultimo:
            log(f"Estado SiAPe: {estado}")
            ultimo = estado
        if estado == ESTADO_ERREH:
            log("Sesion lista dentro de eRreH.")
            return
        if estado == ESTADO_LOGIN:
            if SIAPE_LOGIN_MODE == "manual":
                log("SIAPE_LOGIN_MODE=manual: espero que entres a mano...")
                time.sleep(5)
                continue
            _hacer_login()
            time.sleep(SIAPE_POST_LOGIN_SECONDS)
            desconocidos = 0
            continue
        if estado == ESTADO_SELECTOR:
            _entrar_erreh()
            time.sleep(SIAPE_ERREH_WAIT_SECONDS)
            desconocidos = 0
            continue
        desconocidos += 1
        if desconocidos == 1:
            log("No reconozco la pantalla de SiAPe; espero unos segundos por si esta cargando.")
        if desconocidos > 8:
            raise RuntimeError(
                "SiAPe quedo en una pantalla que no reconozco (ni login, ni selector de modulo, "
                "ni eRreH). Dejalo en el menu principal de eRreH y volve a correr."
            )
        time.sleep(3)
    raise RuntimeError(f"No pude dejar SiAPe listo en eRreH dentro de {timeout or 240} segundos.")


def abrir_novedades_ausentismo(timeout=40):
    """Menu Novedades -> Novedades de Ausentismo, por JAB (sin coordenadas fijas)."""
    _activar_ventana(_buscar_ventana_siape())
    _, menu = _jab_buscar(empieza="Novedades", role="menu", timeout=15)
    if menu:
        _jab_click_bounds(menu)
    else:
        pyautogui.click(*AGENTE_AUSENCIAS_POS["menu_novedades"])
    time.sleep(PAUSA_MEDIA)
    # Con el menu desplegado, el item se elige por nemotecnico (N). Buscar el
    # "menu item" en el arbol JAB tarda decenas de segundos y ademas los items
    # cerrados vienen sin bounds, asi que no sirve para clickear.
    pyautogui.press("n")
    frame, _info = _jab_wait_frame("Ficheros", timeout=timeout)
    return bool(frame)


def _jab_find_frame(nombre, timeout=10, max_segundos=None):
    # profundidad 14: los internal frame estan a ~10-11 y con 18 el recorrido se
    # iba a cientos de celdas de grilla y se cortaba por tiempo sin encontrarlos
    matches = []
    for el, _depth, info in _jab_walk(max_depth=14, timeout=timeout, max_segundos=max_segundos):
        if info.get("role") != "internal frame":
            continue
        if (info.get("name") or "") != nombre:
            continue
        if not _jab_visible_bounds(info):
            continue
        bounds = info.get("bounds") or {}
        area = (bounds.get("width") or 0) * (bounds.get("height") or 0)
        active = 1 if "activo" in (info.get("states") or []) else 0
        matches.append((active, area, el, info))
    if not matches:
        return None, None
    _active, _area, el, info = sorted(matches, key=lambda item: (item[0], item[1]), reverse=True)[0]
    return el, info


def _jab_find_in(root, *, name=None, role=None, desc=None, x_min=None, y_min=None, x_max=None, y_max=None):
    for el, _depth, info in _jab_walk(max_depth=24, root=root):
        bounds = info.get("bounds") or {}
        if not _jab_visible_bounds(info):
            continue
        if role is not None and info.get("role") != role:
            continue
        if name is not None and (info.get("name") or "") != name:
            continue
        if desc is not None and (info.get("description") or "") != desc:
            continue
        x = bounds.get("x", -1)
        y = bounds.get("y", -1)
        if x_min is not None and x < x_min:
            continue
        if y_min is not None and y < y_min:
            continue
        if x_max is not None and x > x_max:
            continue
        if y_max is not None and y > y_max:
            continue
        return el, info
    return None, None


def _jab_read_text(el):
    try:
        return el.text or ""
    except Exception:
        return ""


def _jab_set_text(el, value):
    try:
        el.send_text(str(value))
        return True
    except Exception:
        try:
            el.click(simulate=True)
            time.sleep(PAUSA_CORTA)
            pyautogui.hotkey("ctrl", "a")
            _pegar_texto(str(value))
            return True
        except Exception:
            return False


def _jab_bounds_center(info):
    bounds = info.get("bounds") or {}
    return (
        int((bounds.get("x", 0) + (bounds.get("width", 0) / 2)) * SIAPE_JAB_SCALE),
        int((bounds.get("y", 0) + (bounds.get("height", 0) / 2)) * SIAPE_JAB_SCALE),
    )


def _doble_click_bounds(info):
    w = _buscar_ventana_siape()
    if w:
        _activar_ventana(w)
    x, y = _jab_bounds_center(info)
    pyautogui.doubleClick(x, y)
    time.sleep(PAUSA_CORTA)


def _jab_click_bounds(info):
    w = _buscar_ventana_siape()
    if w:
        _activar_ventana(w)
    x, y = _jab_bounds_center(info)
    pyautogui.click(x, y)
    time.sleep(PAUSA_CORTA)


def _jab_set_text_by_bounds(info, value):
    _jab_click_bounds(info)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    pyautogui.press("end")
    pyautogui.press("backspace", presses=90, interval=0.01)
    pyautogui.press("home")
    pyautogui.keyDown("shift")
    pyautogui.press("end")
    pyautogui.keyUp("shift")
    pyautogui.press("delete")
    time.sleep(PAUSA_CORTA)
    _pegar_texto(str(value))
    time.sleep(PAUSA_CORTA)


def _jab_click_element(el, simulate=False):
    try:
        el.click(simulate=simulate)
    except TypeError:
        el.click()
    time.sleep(PAUSA_CORTA)


def _jab_click_menu_item(menu_name, item_name, timeout=12):
    drv = _jab_driver(timeout=timeout)
    if not drv:
        return False
    try:
        menu = drv.find_element_by_name(menu_name, visible=True)
        for child in _jab_iter_children(menu):
            info = child.get_element_information()
            if (info.get("name") or "") == item_name:
                _jab_click_element(child)
                return True
    except Exception:
        pass
    for el, _depth, info in _jab_walk(max_depth=30, root=drv.root_element):
        if info.get("role") != "menu item":
            continue
        if (info.get("name") or "") != item_name:
            continue
        try:
            _jab_click_element(el, simulate=True)
            return True
        except Exception:
            try:
                _jab_click_element(el)
                return True
            except Exception:
                continue
    try:
        item = drv.find_element_by_name(item_name, visible=False)
        _jab_click_element(item)
        return True
    except Exception as e:
        print(f"AVISO: no pude abrir menu '{menu_name}' -> '{item_name}' por JAB: {e}")
        return False


def _jab_wait_frame(nombre, timeout=15):
    deadline = time.time() + timeout
    while True:
        restante = deadline - time.time()
        if restante <= 0:
            return None, None
        # el corte por tiempo va adentro del recorrido: si no, una sola vuelta
        # se come el timeout entero y el script parece colgado
        frame, info = _jab_find_frame(nombre, timeout=4, max_segundos=min(restante, 20))
        if frame:
            return frame, info
        time.sleep(0.8)


def _jab_select_tab(tab_name, frame_name="Novedades de Ausentismo"):
    # Camino rapido: la pestaña se busca directo, sin detectar el frame primero.
    _tab, tab_directo = _jab_buscar(nombre=tab_name, role="page tab", timeout=15,
                                    banda_y=(480, 570))
    if tab_directo:
        _jab_click_bounds(tab_directo)
        time.sleep(PAUSA_MEDIA)
        return True

    frame, _info = _jab_wait_frame(frame_name, timeout=8)
    if not frame:
        return False
    tab, tab_info = _jab_find_in(frame, name=tab_name, role="page tab")
    if tab:
        _jab_click_bounds(tab_info)
        time.sleep(PAUSA_MEDIA)
        return True
    for tablist, _depth, info in _jab_walk(max_depth=12, root=frame):
        if info.get("role") != "page tab list":
            continue
        try:
            tablist.select(tab_name)
            time.sleep(PAUSA_MEDIA)
            return True
        except Exception:
            try:
                tab = tablist.find_element_by_name(tab_name)
                tab.click(simulate=True)
                time.sleep(PAUSA_MEDIA)
                return True
            except Exception:
                continue
    return False


def _jab_login():
    drv = _jab_driver(timeout=8)
    if not drv:
        return False
    try:
        usuario = drv.find_element_by_name("Usuario", visible=True)
        usuario.send_text(SIAPE_USER)
        try:
            clave = drv.find_element_by_role("password text", visible=True)
        except Exception:
            clave = drv.find_element_by_description("Contraseña", visible=True)
        clave.send_text(SIAPE_PASS)
        ingresar = drv.find_element_by_name("INGRESAR", visible=True)
        ingresar.click()
        return True
    except Exception as e:
        print(f"AVISO: no pude loguear por JAB: {e}")
        return False


def _buscar_imagen_en_pantalla(template_path, timeout=10, confidence=0.82):
    """Busca una plantilla en pantalla con OpenCV y tolera cambios leves de escala."""
    if not template_path or not Path(template_path).exists():
        return None
    try:
        import cv2
        import numpy as np

        tpl = cv2.imread(str(template_path), cv2.IMREAD_COLOR)
        if tpl is None:
            return None
        deadline = time.time() + timeout
        scales = [1.0, 0.95, 1.05, 0.90, 1.10, 0.85, 1.15]
        while time.time() < deadline:
            screen = np.array(pyautogui.screenshot())
            hay = cv2.cvtColor(screen, cv2.COLOR_RGB2BGR)
            best = (0.0, None, None)
            for scale in scales:
                needle = tpl
                if scale != 1.0:
                    needle = cv2.resize(tpl, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                if needle.shape[0] > hay.shape[0] or needle.shape[1] > hay.shape[1]:
                    continue
                res = cv2.matchTemplate(hay, needle, cv2.TM_CCOEFF_NORMED)
                _, score, _, loc = cv2.minMaxLoc(res)
                if score > best[0]:
                    best = (score, loc, needle.shape)
            score, loc, shape = best
            if loc is not None and score >= confidence:
                h, w = shape[:2]
                return loc[0] + w // 2, loc[1] + h // 2, score
            time.sleep(0.5)
    except Exception as e:
        print(f"AVISO: no se pudo buscar imagen {template_path}: {e}")
    return None


def login_siape():
    if os.environ.get("SIAPE_SKIP_LOGIN", "").strip().lower() in ("1", "true", "si", "sí", "yes"):
        abrir_siape_si_falta()
        print("SIAPE_SKIP_LOGIN activo: uso la sesion abierta.")
        return

    if not SIAPE_USER or not SIAPE_PASS:
        raise RuntimeError("Falta SIAPE_USER o SIAPE_PASS en .env.")

    origen = abrir_siape_si_falta()
    if SIAPE_LOGIN_MODE == "manual":
        print("SIAPE_LOGIN_MODE=manual: dejo SiAPe abierto para login manual.")
        return

    print("Intentando login por Java Access Bridge...")
    if _jab_login():
        time.sleep(SIAPE_POST_LOGIN_SECONDS)
        return

    user_pos = _coord_env("SIAPE_LOGIN_USER_POS")
    pass_pos = _coord_env("SIAPE_LOGIN_PASS_POS")
    button_pos = _coord_env("SIAPE_LOGIN_BUTTON_POS")

    print("Ingresando usuario y clave de SiAPe desde variables de entorno...")
    if user_pos:
        pyautogui.click(origen[0] + user_pos[0], origen[1] + user_pos[1])
        time.sleep(PAUSA_CORTA)
    _pegar_texto(SIAPE_USER)

    if pass_pos:
        pyautogui.click(origen[0] + pass_pos[0], origen[1] + pass_pos[1])
        time.sleep(PAUSA_CORTA)
    else:
        pyautogui.press("tab")
        time.sleep(PAUSA_CORTA)
    _pegar_texto(SIAPE_PASS)

    if button_pos:
        pyautogui.click(origen[0] + button_pos[0], origen[1] + button_pos[1])
    else:
        pyautogui.press("enter")
    time.sleep(SIAPE_POST_LOGIN_SECONDS)


def entrar_erreh_si_corresponde():
    if not SIAPE_ENTER_ERREH:
        return

    origen = abrir_siape_si_falta()
    print("Intentando entrar a RRHH por Java Access Bridge...")
    if _jab_click("RRHH", timeout=int(SIAPE_ERREH_WAIT_MENU_SECONDS)):
        time.sleep(SIAPE_ERREH_WAIT_SECONDS)
        return

    print("Buscando eRreH/RRHH en pantalla...")
    encontrado = _buscar_imagen_en_pantalla(
        SIAPE_ERREH_TEMPLATE,
        timeout=SIAPE_ERREH_WAIT_MENU_SECONDS,
    )
    if encontrado:
        x, y, score = encontrado
        print(f"Entrando a eRreH/RRHH por imagen ({x},{y}, score={score:.2f})...")
        pyautogui.click(x, y)
    else:
        erreh_pos = _coord_env("SIAPE_ERREH_POS") or (831, 620)
        print("No encontre eRreH por imagen; uso coordenada de respaldo.")
        pyautogui.click(origen[0] + erreh_pos[0], origen[1] + erreh_pos[1])
    time.sleep(SIAPE_ERREH_WAIT_SECONDS)


# HELPERS DB


def conn():
    return pymysql.connect(**DB, cursorclass=pymysql.cursors.DictCursor)


def traer_pendientes(cn, solo_id=None, limit=None):
    """Registros con procesado=0, con el CUIL resuelto desde `personal`."""
    sql = """
        SELECT r.id, r.dni, p.cuil,
               CONCAT(p.apellido, ' ', p.nombre) AS nombre,
               r.fecha_desde, r.fecha_hasta, r.tipo
          FROM reconocimientos_medicos r
          JOIN personal p ON p.dni = r.dni
         WHERE r.deleted_at IS NULL
           AND r.procesado = 0
           AND r.fecha_desde IS NOT NULL
           AND r.fecha_hasta IS NOT NULL
    """
    params = []
    if solo_id:
        sql += " AND r.id = %s"
        params.append(solo_id)
    sql += " ORDER BY r.id"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)

    with cn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def marcar_procesado(cn, rec_id, errores):
    """procesado=1 y, si hubo dias no cargados, los deja en errores_carga."""
    with cn.cursor() as cur:
        cur.execute(
            "UPDATE reconocimientos_medicos SET procesado = 1, errores_carga = %s WHERE id = %s",
            ("; ".join(errores) if errores else None, rec_id),
        )
    cn.commit()


def dias_corridos(desde, hasta):
    """Expande el rango a dias individuales (corridos, incluye fin de semana)."""
    d, out = desde, []
    while d <= hasta:
        out.append(d)
        d += timedelta(days=1)
    return out


# HELPERS UI


def ventana_siape():
    """Trae al frente la ventana del SiAPe y devuelve su origen (x, y)."""
    w = _buscar_ventana_siape()
    if not w:
        raise RuntimeError(
            f"No encuentro la ventana '{VENTANA_SIAPE}'. "
            "Abri el SiAPe, logueate y dejalo en Novedades de Ausentismo."
        )
    return _activar_ventana(w)


def click(nombre, origen):
    """Click en una coordenada del mapa COORD, relativa al origen de la ventana."""
    x, y = COORD[nombre]
    pyautogui.click(origen[0] + x, origen[1] + y)
    time.sleep(PAUSA_CORTA)


def buscar_dialogo(textos):
    """
    Devuelve el texto encontrado si en pantalla hay un dialogo con alguno de esos textos.

    IMPLEMENTACION SUGERIDA: guardar recortes .png de cada dialogo y usar
    pyautogui.locateOnScreen('dialogo_ya_existe.png', confidence=0.8).
    Requiere: pip install opencv-python

    Los TRES dialogos relevantes (todos vistos en vivo):
      1. Advertencia: "Ya existe una ausencia eventual para el dia DD-MMM-AAAA"
                      -> [Continuar]  en (881, 517)
      2. Forms:       "¿Desea guardar los cambios realizados?"
                      -> [Si] [No] [Cancelar]
      3. Advertencia: "¿Esta seguro que desea Borrar los datos?"   (sale con la X roja)
                      -> [Si] en (836, 517)  [No]
    """
    # 1) Por JAB: es lo confiable. Los .png casi nunca existen en disco, asi que
    #    el metodo viejo devolvia None siempre y los avisos de SiAPe pasaban de largo.
    texto, _botones = leer_dialogo_jab()
    if texto:
        t = texto.lower()
        if "ya existe" in t:
            return "ya_existe"
        if "guardar los cambios" in t or "desea guardar" in t:
            return "guardar_cambios"
        if "borrar los datos" in t:
            return "borrar_datos"
        if "no puede agregar datos" in t:
            return "no_puede_agregar"
        log(f"AVISO: dialogo de SiAPe sin clasificar: {texto[:200]}")
        return "desconocido"

    # 2) Fallback por imagen, si alguna vez se recortan los .png
    for nombre, archivo in textos.items():
        if not archivo or not os.path.exists(archivo):
            continue
        try:
            if pyautogui.locateOnScreen(archivo, confidence=0.8):
                return nombre
        except Exception:
            pass
    return None


DIALOGO_NOMBRES = ("advertencia", "forms", "error", "atencion", "atención", "aviso",
                   "informacion", "información", "confirmar", "confirmacion", "confirmación")


def leer_dialogo_jab(max_segundos=12):
    """
    Devuelve (texto, botones) del dialogo modal abierto, o (None, []).

    `botones` son los `info` de los push button, para poder clickearlos por bounds.
    """
    # Los modales de Forms son `internal frame` colgados a profundidad ~11 y traen
    # el titulo Y el mensaje en el mismo `name` ("Informacion  No puede Agregar Datos.").
    # Con max_depth 14 se llega en ~5s; barrer todo el arbol tarda mas que el timeout.
    raiz = None
    titulo = ""
    for _el, _depth, info in _jab_walk(max_depth=14, max_segundos=max_segundos):
        rol = info.get("role") or ""
        nombre = (info.get("name") or "").strip()
        if not _bounds_ok(info):
            continue
        if rol in ("dialog", "alert") or (
            rol == "internal frame" and nombre.lower().startswith(DIALOGO_NOMBRES)
        ):
            raiz = _el
            titulo = nombre
            break
    if raiz is None:
        return None, []

    partes, botones = [titulo] if titulo else [], []
    for _el, _depth, info in _jab_walk(max_depth=8, root=raiz, max_segundos=max_segundos):
        rol = info.get("role") or ""
        nombre = (info.get("name") or "").strip()
        if rol == "push button" and _bounds_ok(info):
            botones.append(info)
        elif rol in ("label", "text") and nombre:
            partes.append(nombre)
    return " | ".join(partes), botones


def cerrar_modales(max_vueltas=4):
    """
    Cierra los avisos que hayan quedado abiertos.

    Un modal de Forms bloquea la ventana entera: si queda abierto, todos los
    pasos siguientes fallan o esperan para siempre (era el cuelgue tipico).
    """
    cerrados = []
    for _ in range(max_vueltas):
        texto, _botones = leer_dialogo_jab()
        if not texto:
            break
        log(f"Cierro aviso de SiAPe: {texto[:140]}")
        cerrados.append(texto)
        if not cerrar_dialogo_jab():
            break
        time.sleep(PAUSA_MEDIA)
    return cerrados


def cerrar_dialogo_jab(preferidos=("Continuar", "Aceptar", "OK", "Si", "Sí")):
    """Cierra el modal abierto clickeando el primer boton preferido que aparezca."""
    _texto, botones = leer_dialogo_jab()
    if not botones:
        return False
    for quiero in preferidos:
        for info in botones:
            if (info.get("name") or "").strip().lower().startswith(quiero.lower()):
                _jab_click_bounds(info)
                time.sleep(PAUSA_MEDIA)
                return True
    _jab_click_bounds(botones[0])
    time.sleep(PAUSA_MEDIA)
    return True


def _abrir_novedades_ficheros_jab():
    """Abre la busqueda `Ficheros` de Novedades de Ausentismo."""
    # Un aviso pendiente del paso anterior bloquea el menu entero.
    cerrar_modales()

    # Si Ficheros ya esta abierto (agente anterior), no hace falta pasar por el menu.
    frame, _info = _jab_wait_frame("Ficheros", timeout=3)
    if frame:
        return True

    if abrir_novedades_ausentismo():
        return True

    # Ultimo recurso: las coordenadas calibradas sobre 1920x1080 maximizado.
    log("AVISO: no pude abrir Novedades por JAB; pruebo con las coordenadas fijas.")
    _activar_ventana(_buscar_ventana_siape())
    pyautogui.click(*AGENTE_AUSENCIAS_POS["menu_novedades"])
    time.sleep(PAUSA_CORTA)
    pyautogui.click(*AGENTE_AUSENCIAS_POS["menu_novedades_ausentismo"])
    time.sleep(PAUSA_MEDIA)
    frame, _info = _jab_wait_frame("Ficheros", timeout=20)
    return bool(frame)


def _campo_apellido_ficheros(timeout=25):
    """El buscador de Ficheros: campo APELLIDO Y NOMBRE de la franja de arriba."""
    return _jab_buscar(nombre="APELLIDO Y NOMBRE", role="text", timeout=timeout,
                       banda_y=(100, 200), x_min=150, y_min=100, y_max=200)


def _en_ficheros(timeout=6):
    """FILTRAR solo existe en la pantalla Ficheros: sirve para no confundirla
    con la pantalla del agente, que tiene un campo de nombre casi igual."""
    _b, info = _jab_buscar(nombre="FILTRAR", role="push button", timeout=timeout,
                           banda_y=(100, 200))
    return info is not None


def _buscar_agente_en_ficheros_jab(nombre, cuil=None):
    """Busca por apellido/nombre en Ficheros y abre `NOVEDADES` del primer resultado."""
    cerrar_modales()

    # OJO: si quedo abierta la pantalla de un agente, su campo "APELLIDO y NOMBRE"
    # se parece al buscador de Ficheros. Sin este chequeo el script escribia ahi
    # y terminaba abriendo otra persona.
    if not _en_ficheros():
        _abrir_novedades_ficheros_jab()
        cerrar_modales()
    if not _en_ficheros(timeout=20):
        raise RuntimeError("No estoy en la pantalla Ficheros (no encuentro el boton FILTRAR).")

    _campo, campo_info = _campo_apellido_ficheros(timeout=25)
    if not campo_info:
        raise RuntimeError("No encuentro el campo APELLIDO Y NOMBRE de Ficheros.")

    busqueda = " ".join(str(nombre or "").split()).strip()
    intentos = [busqueda]
    if busqueda:
        intentos.append(busqueda.split()[0])

    ultimo_error = ""
    for texto_busqueda in [i for i in intentos if i]:
        _campo, campo_info = _campo_apellido_ficheros(timeout=20)
        if not campo_info:
            raise RuntimeError("No pude escribir en APELLIDO Y NOMBRE de Ficheros.")
        _jab_set_text_by_bounds(campo_info, texto_busqueda)

        _filtrar, filtrar_info = _jab_buscar(nombre="FILTRAR", role="push button",
                                             timeout=20, banda_y=(100, 200))
        if not filtrar_info:
            raise RuntimeError("No encuentro boton FILTRAR en Ficheros.")
        # OJO: aca NO va un Enter. Sobre la grilla, Forms lo toma como "insertar
        # registro" y salta "No puede Agregar Datos", que traba todo lo que sigue.
        _jab_click_bounds(filtrar_info)
        time.sleep(PAUSA_LARGA)
        cerrar_modales()

        fila, fila_info = _jab_buscar(nombre="APELLIDO Y NOMBRE", role="text", timeout=20,
                                      banda_y=(255, 340), x_min=90, y_min=255, y_max=340)
        texto_fila = _jab_read_text(fila).strip() if fila else ""
        if not texto_fila:
            ultimo_error = f"sin resultado para '{texto_busqueda}'"
            continue

        # La fila tiene que ser el agente buscado: abrir a otra persona y
        # cargarle una ausencia seria mucho peor que no cargar nada.
        apellido = busqueda.split()[0].upper() if busqueda else ""
        if apellido and apellido not in texto_fila.upper():
            raise RuntimeError(
                f"La fila de Ficheros dice '{texto_fila}' y yo buscaba '{busqueda}'. Freno."
            )

        # Se entra al agente posicionandose en la celda LEGAJO de la fila y
        # haciendo DOBLE CLICK (asi se opera a mano). El boton NOVEDADES por si
        # solo dejaba la pantalla a medio abrir y disparaba "No puede Agregar Datos".
        _legajo, legajo_info = _jab_buscar(empieza="LEGAJO", role="text", timeout=20,
                                           banda_y=(255, 340), x_max=110, y_min=255, y_max=340)
        objetivo = legajo_info or fila_info
        _doble_click_bounds(objetivo)
        time.sleep(PAUSA_LARGA)
        cerrar_modales()

        # Confirmacion de que llegamos a la pantalla del agente: la solapa de
        # pestañas. (El combo TIPO DE AUSENCIA no sirve para esto: el agente abre
        # en la pestaña HORARIO y ese combo recien existe en AUSENCIAS.)
        _tab, tab_info = _jab_buscar(nombre=TAB_AUSENCIAS, role="page tab",
                                     timeout=30, banda_y=(480, 570))
        if not tab_info:
            raise RuntimeError(
                f"Clickee NOVEDADES para '{texto_fila}' pero no llegue a la pantalla del agente."
            )
        log(f"   agente SIAPE: {texto_fila}")
        return

    raise RuntimeError(f"No encontre agente en Ficheros ({ultimo_error}).")


TAB_AUSENCIAS = "AUSENCIAS Y PRESENTES"


def seleccionar_agente_ausencias(cuil, nombre):
    _buscar_agente_en_ficheros_jab(nombre, cuil=cuil)
    if not _jab_select_tab(TAB_AUSENCIAS):
        # fallback: la coordenada calibrada sobre 1920x1080 maximizado
        _click_abs("tab_ausencias")
    time.sleep(PAUSA_MEDIA)
    cerrar_modales()


def _click_abs(nombre):
    w = _buscar_ventana_siape()
    if not w:
        raise RuntimeError(f"No encuentro la ventana '{VENTANA_SIAPE}'.")
    _activar_ventana(w)
    x, y = AGENTE_AUSENCIAS_POS[nombre]
    pyautogui.click(x, y)
    time.sleep(PAUSA_CORTA)


def _limpiar_y_escribir(texto):
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    pyautogui.press("end")
    pyautogui.press("backspace", presses=80, interval=0.01)
    time.sleep(0.1)
    _pegar_texto(str(texto))
    time.sleep(PAUSA_CORTA)


def _elegir_tipo_ausencia_agente():
    _click_abs("combo_tipo")
    pyautogui.write("FRANCO", interval=0.05)
    time.sleep(PAUSA_CORTA)
    pyautogui.press("down", presses=2)
    pyautogui.press("enter")
    time.sleep(PAUSA_MEDIA)


def _guardar_ausencia_agente():
    _click_abs("btn_guardar")
    time.sleep(PAUSA_CORTA)
    pyautogui.press("f10")
    time.sleep(PAUSA_LARGA)


def _campo_ausencias(frame, **kw):
    campo, info = _jab_find_in(frame, **kw)
    return info


def _combo_tipo(frame):
    return _jab_find_in(frame, role="combo box", desc="TIPO DE AUSENCIA")


def _opciones_tipo(combo, combo_info):
    """
    Lista las opciones del combo en orden, marcando cual esta seleccionada.

    Las 23 opciones son `label` hijos del combo y la elegida trae el estado
    'seleccionado'. Es la unica forma confiable de LEER el tipo: el texto del
    combo viene vacio (Forms no expone Accessible Text ahi).
    """
    propio = (combo_info.get("name") or "")
    opciones = []
    for _el, _d, info in _jab_walk(max_depth=4, root=combo, max_segundos=25):
        nombre = (info.get("name") or "").strip()
        if not nombre or nombre == propio or info.get("role") != "label":
            continue
        estados = [e.lower() for e in (info.get("states") or [])]
        opciones.append((nombre, any(e in ("seleccionado", "marcado", "checked") for e in estados)))
    return opciones


def tipo_seleccionado_root():
    """Igual que tipo_seleccionado pero buscando el combo desde la raiz."""
    combo, combo_info = _jab_buscar(role="combo box", desc="TIPO DE AUSENCIA",
                                    timeout=20, banda_y=(180, 240))
    if not combo:
        return None
    for nombre, elegido in _opciones_tipo(combo, combo_info):
        if elegido:
            return nombre
    return None


def tipo_seleccionado(frame):
    combo, combo_info = _combo_tipo(frame)
    if not combo:
        return None
    for nombre, elegido in _opciones_tipo(combo, combo_info):
        if elegido:
            return nombre
    return None


def _elegir_tipo_ausencia_jab(combo, combo_info, tipo):
    """
    Deja el combo en `tipo`, verificando contra el estado real del control.

    El metodo viejo (type-ahead "FRANCO" + 2 flechas abajo) era a ciegas: si la
    lista cambiaba de orden cargaba otra cosa y no habia forma de saberlo. Aca
    se mueve con las flechas y se relee la opcion marcada como 'seleccionado'.
    """
    opciones = _opciones_tipo(combo, combo_info)
    nombres = [n for n, _ in opciones]
    if tipo not in nombres:
        raise RuntimeError(f"'{tipo}' no esta en el combo TIPO DE AUSENCIA ({len(nombres)} opciones).")
    destino = nombres.index(tipo)

    _jab_click_bounds(combo_info)      # foco en el combo
    time.sleep(PAUSA_CORTA)

    for _intento in range(8):
        opciones = _opciones_tipo(combo, combo_info)
        actual = next((k for k, (_n, sel) in enumerate(opciones) if sel), None)
        if actual == destino:
            return True
        if actual is None:
            pyautogui.press("down")
            time.sleep(PAUSA_CORTA)
            continue
        delta = destino - actual
        pyautogui.press("down" if delta > 0 else "up", presses=abs(delta), interval=0.06)
        time.sleep(PAUSA_CORTA)
    return False


def _tildar_justificado(frame=None):
    campo, info = _jab_buscar(nombre="JUSTIFICADO.", role="check box", timeout=15,
                              banda_y=(250, 290))
    if not campo:
        campo, info = _jab_buscar(desc="JUSTIFICADO.", role="check box", timeout=10,
                                  banda_y=(250, 290))
    if not campo:
        log("AVISO: no encuentro el check JUSTIFICADO; uso la coordenada fija.")
        _click_abs("check_justificado")
        return
    estados = [e.lower() for e in (info.get("states") or [])]
    if any(e in ("seleccionado", "marcado", "checked") for e in estados):
        return
    _jab_click_bounds(info)


AVISO_EXITO = "se han guardado los cambios"


def _resolver_avisos(dia):
    """
    Encadena los avisos que tira SiAPe despues de guardar.

    Devuelve (ok, motivo). "¿Desea guardar los cambios?" se contesta Si y se
    sigue mirando, porque el rechazo real (ya existe / se superpone con una
    carpeta medica / etc.) recien aparece despues.
    """
    for _vuelta in range(6):
        texto, _botones = leer_dialogo_jab()
        if not texto:
            return True, ""
        limpio = " ".join(texto.split())
        t = limpio.lower()
        if AVISO_EXITO in t:
            # SiAPe confirma el alta con este aviso. Es LA señal de que quedo
            # guardado: sin esto no hay forma de distinguir un alta real de un
            # registro que quedo sucio en pantalla.
            cerrar_dialogo_jab()
            return True, "GUARDADO"
        if "guardar los cambios" in t or "desea guardar" in t:
            cerrar_dialogo_jab(preferidos=("Si", "Sí"))
            time.sleep(PAUSA_MEDIA)
            continue
        motivo = limpio[:180]
        if "ya existe" in t:
            motivo = "ya existia una ausencia ese dia"
        cerrar_modales()
        return False, f"{dia:%d/%m/%Y}: {motivo}"
    return False, f"{dia:%d/%m/%Y}: no pude cerrar los avisos de SiAPe"


def _registro_nuevo():
    """
    El `+` verde va DESPUES de guardar (asi se opera a mano): deja el formulario
    limpio para el dia siguiente. Apretarlo antes lo rechaza con "No puede
    Agregar Datos".
    """
    _agregar, agregar_info = _jab_buscar(nombre="Agregar", role="push button", timeout=10)
    if agregar_info:
        _jab_click_bounds(agregar_info)
    else:
        _click_abs("btn_agregar")
    time.sleep(PAUSA_MEDIA)


def asegurar_pestana_ausencias(intentos=3):
    """
    Deja la pantalla del agente en AUSENCIAS Y PRESENTES y devuelve (combo, info).

    Se devuelve el combo YA encontrado porque volver a buscarlo desde la raiz
    cuesta ~20s en esta pantalla: releerlo en cada paso era lo que hacia fallar
    la verificacion del tipo aunque la seleccion funcionara.
    """
    for _intento in range(intentos):
        cerrar_modales()
        combo, combo_info = _jab_buscar(role="combo box", desc="TIPO DE AUSENCIA",
                                        timeout=30, banda_y=(180, 240))
        if combo:
            return combo, combo_info
        if not _jab_select_tab(TAB_AUSENCIAS):
            _click_abs("tab_ausencias")
        time.sleep(PAUSA_MEDIA)
    raise RuntimeError("No pude dejar la pantalla del agente en AUSENCIAS Y PRESENTES.")


def cargar_dia_ausencia_agente(dia, dialogos=None):
    """
    Carga un dia en la pestaña AUSENCIAS Y PRESENTES del agente.

    Orden (el mismo que a mano): completar arriba -> Guardar -> `+` verde.
      TIPO DE AUSENCIA (combo, x~61 y~210) | FECHA (x~394 y~210)
      PARTIDO se deja vacio                | JUSTIFICADO. (check, x~408 y~267)
    """
    combo, combo_info = asegurar_pestana_ausencias()

    if not _elegir_tipo_ausencia_jab(combo, combo_info, TIPO_AUSENCIA):
        quedo = next((n for n, sel in _opciones_tipo(combo, combo_info) if sel), None)
        _registro_nuevo()
        cerrar_modales()
        return False, (f"{dia:%d/%m/%Y}: no pude dejar el combo en '{TIPO_AUSENCIA}' "
                       f"(quedo en '{quedo}'); no guardo")
    log(f"   TIPO DE AUSENCIA = {TIPO_AUSENCIA}")

    _fecha, fecha_info = _jab_buscar(nombre="FECHA", role="text", timeout=20,
                                     banda_y=(195, 235), x_min=360, x_max=520)
    if not fecha_info:
        raise RuntimeError("No encuentro el campo FECHA de la ausencia.")
    _jab_set_text_by_bounds(fecha_info, dia.strftime("%d/%m/%Y"))

    _tildar_justificado()        # PARTIDO queda vacio, por regla

    _guardar, guardar_info = _jab_buscar(nombre="Guardar", role="push button", timeout=15)
    if guardar_info:
        _jab_click_bounds(guardar_info)
    else:
        _click_abs("btn_guardar")
    time.sleep(PAUSA_LARGA)

    ok, motivo = _resolver_avisos(dia)
    if not ok:
        _registro_nuevo()
        cerrar_modales()
        return False, motivo

    if motivo == "GUARDADO":
        _registro_nuevo()          # `+` verde: deja el formulario para el dia siguiente
        cerrar_modales()
        return True, ""

    # Sin confirmacion explicita: el `+` verde fuerza la definicion (si no habia
    # commiteado, Forms pregunta por los cambios y ahi sale el rechazo real).
    _registro_nuevo()
    ok, motivo = _resolver_avisos(dia)
    if not ok:
        cerrar_modales()
        return False, motivo
    if motivo == "GUARDADO":
        return True, ""
    return False, f"{dia:%d/%m/%Y}: SiAPe no confirmo el guardado; no lo doy por cargado"


def _set_compensatorios_field(frame, name, value, *, x_min=None, x_max=None, y_min=None, y_max=None):
    campo, info = _jab_find_in(
        frame,
        name=name,
        role="text",
        x_min=x_min,
        x_max=x_max,
        y_min=y_min,
        y_max=y_max,
    )
    if not campo:
        raise RuntimeError(f"No encuentro campo {name!r} en COMPENSATORIOS.")
    _jab_set_text_by_bounds(info, value)


def _set_compensatorios_combo(frame):
    combo, info = _jab_find_in(
        frame,
        role="combo box",
        desc="Tipo Ausencia por Hora",
        x_min=40,
        x_max=260,
        y_min=180,
        y_max=220,
    )
    if not combo:
        return
    _jab_click_bounds(info)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    _pegar_texto(SIAPE_COMP_TIPO)
    pyautogui.press("enter")
    time.sleep(PAUSA_CORTA)


def cargar_dia_compensatorio_jab(dia, dialogos=None):
    """
    Carga un dia en la pestaña COMPENSATORIOS usando el mapeo JAB.

    Los horarios/cantidad salen de env:
      SIAPE_COMP_CANT_HORAS, SIAPE_COMP_HORA_DESDE, SIAPE_COMP_HORA_HASTA.
    """
    if not _jab_select_tab("COMPENSATORIOS", frame_name="Novedades de Ausentismo"):
        raise RuntimeError("No pude seleccionar COMPENSATORIOS.")

    frame, _info = _jab_wait_frame("Novedades de Ausentismo", timeout=10)
    if not frame:
        raise RuntimeError("No encuentro Novedades de Ausentismo para cargar COMPENSATORIOS.")

    fecha = dia.strftime("%d/%m/%Y")
    _set_compensatorios_combo(frame)
    _set_compensatorios_field(frame, "Fecha Novedad", fecha, x_min=240, x_max=360, y_min=180, y_max=225)
    _set_compensatorios_field(frame, "Cant. Horas", SIAPE_COMP_CANT_HORAS, x_min=360, x_max=450, y_min=180, y_max=225)
    _set_compensatorios_field(frame, "Fecha", fecha, x_min=60, x_max=180, y_min=250, y_max=290)
    _set_compensatorios_field(frame, "Hora Desde", SIAPE_COMP_HORA_DESDE, x_min=180, x_max=300, y_min=250, y_max=295)
    _set_compensatorios_field(frame, "Hora Hasta", SIAPE_COMP_HORA_HASTA, x_min=280, x_max=390, y_min=250, y_max=295)

    drv = _jab_driver(timeout=8)
    guardar_info = None
    if drv is not None:
        _guardar, guardar_info = _jab_find_in(drv.root_element, name="Guardar", role="push button")
    if guardar_info:
        _jab_click_bounds(guardar_info)
    elif not _jab_click("Guardar", timeout=8):
        origen = ventana_siape()
        click("btn_guardar", origen)
    time.sleep(PAUSA_LARGA)

    hallado = buscar_dialogo(dialogos or {})
    if hallado == "ya_existe":
        origen = ventana_siape()
        click("dlg_continuar", origen)
        time.sleep(PAUSA_MEDIA)
        return False, f"{dia:%d/%m/%Y}: ya existia una ausencia ese dia"
    return True, ""


def seleccionar_agente(cuil, origen):
    """Abre el Buscador de Persona, busca por CUIL y acepta el primer resultado."""
    click("btn_puntos_legajo", origen)
    time.sleep(PAUSA_MEDIA)

    click("radio_cuil", origen)                      # radio "Cuit/Cuil"
    pyautogui.tripleClick(origen[0] + COORD["input_busqueda"][0],
                          origen[1] + COORD["input_busqueda"][1])
    pyautogui.typewrite(str(cuil))
    click("btn_buscar", origen)
    time.sleep(PAUSA_LARGA)

    click("primera_fila", origen)
    click("btn_aceptar", origen)
    time.sleep(PAUSA_LARGA)


def elegir_tipo_ausencia(origen):
    """
    Selecciona FRANCO COMPENSATORIO (COMUNICACIONES) en el combo.

    CALIBRADO EN VIVO:
      - El combo NO permite escribir libre, pero SI acepta type-ahead: al tipear
        "FRANCO" salta y resalta el primero de los tres consecutivos.
      - Orden exacto de la lista:
            FRANCO COMPENSATORIO                    <- cae aca con "FRANCO"
            FRANCO COMPENSATORIO (AERONAUTICOS)     <- +1 abajo
            FRANCO COMPENSATORIO (COMUNICACIONES)   <- +2 abajo  (el que queremos)
      - Enter confirma y el texto queda en el campo.
    """
    click("combo_tipo", origen)
    time.sleep(PAUSA_MEDIA)
    pyautogui.typewrite("FRANCO")                    # type-ahead
    time.sleep(PAUSA_CORTA)
    pyautogui.press("down", presses=2)               # -> (COMUNICACIONES)
    time.sleep(PAUSA_CORTA)
    pyautogui.press("enter")
    time.sleep(PAUSA_MEDIA)


def descartar_registro(origen, dialogos):
    """
    Descarta el registro en edicion (X roja).
    Aparece "¿Esta seguro que desea Borrar los datos?" [Si] [No] -> Si.
    """
    click("btn_borrar", origen)
    time.sleep(PAUSA_MEDIA)
    click("dlg_si", origen)
    time.sleep(PAUSA_MEDIA)


def cargar_dia(dia, origen, dialogos):
    """
    Carga un dia. Devuelve (ok, motivo).
      ok=True  -> guardado
      ok=False -> no se cargo; motivo explica por que (va a errores_carga)

    Secuencia CALIBRADA en vivo:
      + verde -> combo (type-ahead "FRANCO" + 2 abajo + Enter) -> Tab -> fecha
      -> click JUSTIFICADO -> disquete
    """
    click("btn_agregar", origen)                     # + verde: limpia el form
    time.sleep(PAUSA_MEDIA)

    elegir_tipo_ausencia(origen)

    # CALIBRADO: desde el combo, Tab lleva al campo FECHA (no hace falta click).
    pyautogui.press("tab")
    time.sleep(PAUSA_CORTA)
    pyautogui.typewrite(dia.strftime("%d/%m/%Y"))
    time.sleep(PAUSA_CORTA)

    # CALIBRADO: Tab NO llega a JUSTIFICADO (pasa a PARTIDO) -> hay que clickear.
    click("check_justificado", origen)
    click("btn_guardar", origen)                     # disquete
    time.sleep(PAUSA_LARGA)

    hallado = buscar_dialogo(dialogos)

    if hallado == "ya_existe":
        # OJO: SiAPe considera "ausencia eventual" a CUALQUIER registro de ese dia,
        # incluido un PRESENTE. Por eso este caso va a ser frecuente.
        click("dlg_continuar", origen)               # [Continuar]
        time.sleep(PAUSA_MEDIA)
        descartar_registro(origen, dialogos)         # el registro quedo sin commitear
        return False, f"{dia:%d/%m/%Y}: ya existia una ausencia ese dia"

    if hallado == "guardar_cambios":
        pyautogui.press("y")                         # Si
        time.sleep(PAUSA_MEDIA)

    return True, ""


# MAIN


def main():
    global _LOG_FH

    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="solo muestra la cola")
    ap.add_argument("--id", type=int, help="procesar un unico id")
    ap.add_argument("--limit", type=int, help="procesar los primeros N registros")
    ap.add_argument("--max-days", type=int, help="procesar solo N dias por registro, sin marcar procesado")
    ap.add_argument("--from-date", help="empezar desde DD/MM/YYYY dentro del rango")
    ap.add_argument("--log", help="archivo de log (ademas de la consola)")
    ap.add_argument("--solo-abrir", action="store_true",
                    help="deja el agente abierto en SiAPe y corta sin guardar nada")
    args = ap.parse_args()

    if args.log:
        try:
            _LOG_FH = open(args.log, "a", encoding="utf-8")
        except Exception as e:
            print(f"AVISO: no pude abrir el log {args.log}: {e}")

    cn = conn()
    pendientes = traer_pendientes(cn, solo_id=args.id, limit=args.limit)

    total_dias = sum(
        len(dias_corridos(r["fecha_desde"], r["fecha_hasta"])) for r in pendientes
    )
    log(f"{len(pendientes)} registro(s) pendiente(s) - {total_dias} dia(s) a cargar")

    for r in pendientes:
        dias = dias_corridos(r["fecha_desde"], r["fecha_hasta"])
        log(f"  #{r['id']:<4} {r['nombre']:<38} CUIL {r['cuil']}  "
            f"{r['fecha_desde']:%d/%m/%Y} a {r['fecha_hasta']:%d/%m/%Y}  ({len(dias)}d)")

    if args.dry_run:
        log("--dry-run: no se toco el SiAPe.")
        return

    if pyautogui is None:
        raise RuntimeError("Falta pyautogui:  pip install pyautogui pygetwindow")

    pyautogui.FAILSAFE = SIAPE_PYAUTOGUI_FAILSAFE

    # Dialogos a detectar. Generar estos .png recortando la pantalla la primera vez.
    dialogos = {
        "ya_existe":       os.path.join(os.path.dirname(__file__), "siape_ya_existe.png"),
        "guardar_cambios": os.path.join(os.path.dirname(__file__), "siape_guardar_cambios.png"),
    }

    # Login + eRreH en un solo paso, guiado por el estado real de la pantalla.
    asegurar_sesion()
    cerrar_modales()                    # avisos que hayan quedado de una corrida anterior
    origen = ventana_siape()            # trae la ventana al frente

    pyautogui.PAUSE = PAUSA_CORTA
    usar_legacy = SIAPE_FLOW in ("legacy", "legacy_ausencias", "ausencias_eventuales")
    usar_compensatorios = SIAPE_FLOW in ("compensatorios", "compensatorio", "horas_compensatorias")
    usar_agente_ausencias = not usar_legacy and not usar_compensatorios
    if usar_agente_ausencias:
        log("Flujo SIAPE: Novedades/Ficheros -> AUSENCIAS Y PRESENTES")
    elif usar_compensatorios:
        log("Flujo SIAPE: Novedades/Ficheros -> COMPENSATORIOS "
            f"({SIAPE_COMP_CANT_HORAS}h {SIAPE_COMP_HORA_DESDE}-{SIAPE_COMP_HORA_HASTA})")
    else:
        log("Flujo SIAPE: legacy Ausencias Eventuales")

    for r in pendientes:
        log(f"-- #{r['id']} {r['nombre']} ---------------------")
        if usar_agente_ausencias:
            seleccionar_agente_ausencias(r["cuil"], r["nombre"])
        elif usar_compensatorios:
            seleccionar_agente_compensatorios(r["cuil"], r["nombre"])
        else:
            seleccionar_agente(r["cuil"], origen)

        if args.solo_abrir:
            log("--solo-abrir: llegue a la pantalla del agente y corto sin guardar nada.")
            break

        errores, cargados = [], 0
        dias_a_cargar = dias_corridos(r["fecha_desde"], r["fecha_hasta"])
        if args.from_date:
            desde_arg = date.fromisoformat(
                "-".join(reversed(args.from_date.replace("-", "/").split("/")))
            )
            dias_a_cargar = [d for d in dias_a_cargar if d >= desde_arg]
        if args.max_days:
            dias_a_cargar = dias_a_cargar[:args.max_days]
        for dia in dias_a_cargar:
            log(f"   cargando {dia:%d/%m/%Y}...")
            if usar_agente_ausencias:
                ok, motivo = cargar_dia_ausencia_agente(dia, dialogos)
            elif usar_compensatorios:
                ok, motivo = cargar_dia_compensatorio_jab(dia, dialogos)
            else:
                ok, motivo = cargar_dia(dia, origen, dialogos)
            if ok:
                cargados += 1
                log(f"   OK   {dia:%d/%m/%Y}")
            else:
                errores.append(motivo)
                log(f"   SKIP {motivo}")

        if args.max_days or args.solo_abrir:
            log(f"   -> prueba parcial: {cargados} cargado(s), {len(errores)} salteado(s). "
                "No marco procesado.")
        else:
            marcar_procesado(cn, r["id"], errores)
            log(f"   -> {cargados} cargado(s), {len(errores)} salteado(s). procesado=1")

    cn.close()
    log("Listo.")


if __name__ == "__main__":
    # Sin esto, cualquier error queda como traceback mudo en un `cmd /k` abierto
    # para siempre: desde afuera se ve igual que un cuelgue.
    try:
        main()
    except KeyboardInterrupt:
        log("Cancelado a mano (Ctrl+C).")
        sys.exit(130)
    except Exception as e:
        import traceback

        log(f"ERROR: {e}")
        for linea in traceback.format_exc().splitlines():
            log(f"    {linea}")
        sys.exit(1)
