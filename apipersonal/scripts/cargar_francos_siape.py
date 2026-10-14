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
  - Cada dia se anota apenas termina en siape_carga_dias (dni+fecha unico):
    CARGADO / YA_EXISTIA no se vuelven a intentar; ERROR se reintenta hasta
    SIAPE_MAX_INTENTOS. Si la corrida se corta, retoma donde quedo.
  - procesado=1 recien cuando todos los dias del registro quedaron CARGADO o
    YA_EXISTIA. Con errores el registro sigue pendiente (no se abre el agente
    si no le queda ningun dia para intentar).

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

# detalle por agente para la pagina Robots (script_run_items)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN

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
# Buscar el agente por DNI desde la ficha. APAGADO: probado 12/10 en Novedades de
# Ausentismo, los '...' de LEGAJO y de APELLIDO NO abren el 'Buscador de Personas'
# (el de LEGAJO busca por el legajo de la ficha -> "No se han encontrado personas").
SIAPE_BUSCAR_POR_DNI = os.environ.get("SIAPE_BUSCAR_POR_DNI", "false").strip().lower() in ("1", "true", "si", "yes")
# Un dia en ERROR se reintenta en las corridas siguientes hasta este tope.
SIAPE_MAX_INTENTOS = int(os.environ.get("SIAPE_MAX_INTENTOS", "3") or "3")
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
    _rearmar_perro()


# Perro guardian: una llamada JAB a SiAPe puede no volver nunca (12/10: 30 min colgado
# en BOLIG sin CPU). Si pasan SIAPE_COLGADO_MIN sin ninguna linea de log, se vuelca en
# que linea estaba y el proceso termina; el estado va por dia, el proximo arranque sigue.
SIAPE_COLGADO_MIN = float(os.environ.get("SIAPE_COLGADO_MIN", "10") or "10")


def _rearmar_perro():
    try:
        import faulthandler
        faulthandler.dump_traceback_later(SIAPE_COLGADO_MIN * 60, exit=True,
                                          file=_LOG_FH if _LOG_FH is not None else sys.stderr)
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


_CIERRE_AL_SALIR = {"registrado": False}


def _cerrar_siape_al_salir():
    """El robot que toca SiAPe lo cierra al terminar (ok, error o Ctrl+C), asi el
    proximo arranca con login limpio. SIAPE_CERRAR_AL_FINAL=false lo deja abierto."""
    if _CIERRE_AL_SALIR["registrado"]:
        return
    if os.environ.get("SIAPE_CERRAR_AL_FINAL", "true").strip().lower() in ("0", "false", "no"):
        return
    import atexit

    def _cerrar():
        try:
            cerrar_siape()
        except Exception as e:
            log(f"AVISO: no pude cerrar SiAPe al salir: {e}")

    atexit.register(_cerrar)
    _CIERRE_AL_SALIR["registrado"] = True


def abrir_siape_si_falta():
    _cerrar_siape_al_salir()
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


def _pids_siape():
    """PIDs de los procesos duenos de ventanas de SiAPe (por titulo)."""
    import win32gui
    import win32process

    pids = set()

    def _cb(hwnd, _):
        if VENTANA_SIAPE.lower() in (win32gui.GetWindowText(hwnd) or "").lower():
            pids.add(win32process.GetWindowThreadProcessId(hwnd)[1])
        return True

    win32gui.EnumWindows(_cb, None)
    pids.discard(0)
    return pids


def cerrar_siape(espera=10):
    """
    Cierra SiAPe para que el proximo robot arranque de cero (login limpio).
    Primero WM_CLOSE a sus ventanas; si en `espera` s siguen vivas, mata SOLO los
    procesos duenos de esas ventanas (y sus hijos). No toca otros Java.
    Devuelve la cantidad de procesos que habia.
    """
    import win32con
    import win32gui

    pids = _pids_siape()
    if not pids:
        return 0
    log(f"Cerrando SiAPe (pid {', '.join(map(str, sorted(pids)))})...")

    def _cb(hwnd, _):
        if VENTANA_SIAPE.lower() in (win32gui.GetWindowText(hwnd) or "").lower():
            try:
                win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
        return True

    win32gui.EnumWindows(_cb, None)
    limite = time.time() + espera
    while time.time() < limite and _pids_siape():
        time.sleep(1)
    vivos = {p for p in _pids_siape() | pids if _pid_vivo(p)}
    for pid in vivos:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, text=True)
    limite = time.time() + 15             # el proceso tarda unos segundos en morir
    while time.time() < limite and (_pids_siape() or any(_pid_vivo(p) for p in pids)):
        time.sleep(1)
    if _pids_siape() or any(_pid_vivo(p) for p in pids):
        log("AVISO: SiAPe sigue abierto despues de cerrarlo.")
    else:
        log("SiAPe cerrado" + (" (forzado)." if vivos else "."))
    return len(pids)


def _pid_vivo(pid):
    """Vivo de verdad (exit code STILL_ACTIVE). tasklist no sirve: si este proceso tiene el
    JAB enganchado, el Java ya terminado sigue listado hasta que salimos."""
    import ctypes

    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        code = ctypes.c_ulong()
        return bool(k.GetExitCodeProcess(h, ctypes.byref(code))) and code.value == 259
    finally:
        k.CloseHandle(h)


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


def _jab_walk(max_depth=30, max_nodes=4000, root=None, timeout=10, max_segundos=None, banda_y=None,
              podar=None):
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
        if depth < max_depth and _banda_ok(info, banda_y) and not (podar and podar(info)):
            for child in _jab_iter_children(el):
                queue.append((child, depth + 1))


def _jab_visible_bounds(info):
    bounds = info.get("bounds") or {}
    states = info.get("states") or []
    # OJO: x puede valer 0 (la ficha del agente esta en x=0). El `(x or -1)` de
    # antes convertia ese 0 en -1 y la daba por invisible: rotaciones nunca la
    # encontraba ("No pude dejar la pantalla del agente en AUSENCIAS...").
    x = bounds.get("x")
    return (
        "visible" in states
        and "mostrando" in states
        and x is not None and x >= 0
        and (bounds.get("width", 0) or 0) > 0
        and (bounds.get("height", 0) or 0) > 0
    )


def _bounds_ok(info):
    b = info.get("bounds") or {}
    x = b.get("x")       # x=0 es valido (ver _jab_visible_bounds)
    return x is not None and x >= 0 and (b.get("width", 0) or 0) > 0 and (b.get("height", 0) or 0) > 0


def _jab_buscar(nombre=None, role=None, desc=None, empieza=None, timeout=None,
                banda_y=None, x_min=None, x_max=None, y_min=None, y_max=None, root=None):
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
                                           banda_y=banda_y, root=root):
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


_FRAME_AUSENCIAS = {"el": None}


def _frame_ausencias(max_segundos=30):
    """
    El internal frame "Novedades de Ausentismo" (la ficha del agente), cacheado.

    Ficheros queda abierto ATRAS de la ficha y sigue en el arbol JAB con su
    grilla de cientos de celdas: buscar desde la raiz pasaba primero por ahi y se
    cortaba por tiempo sin llegar al combo. Aca no se baja a NINGUN internal
    frame: se llega derecho al de la ficha y despues se busca solo adentro.
    """
    el = _FRAME_AUSENCIAS["el"]
    if el is not None:
        try:
            info = el.get_element_information()
            if info.get("name") == FRAME_AUSENCIAS and _jab_visible_bounds(info):
                return el
        except Exception:
            pass
        _FRAME_AUSENCIAS["el"] = None
    for el, _d, info in _jab_walk(max_depth=14, max_segundos=max_segundos,
                                  podar=lambda i: i.get("role") == "internal frame"):
        if (info.get("role") == "internal frame" and info.get("name") == FRAME_AUSENCIAS
                and _jab_visible_bounds(info)):
            _FRAME_AUSENCIAS["el"] = el
            return el
    return None


def _jab_buscar_ausencias(*, timeout=20, **kw):
    """Busca un control de la ficha del agente adentro de su frame; si no, el recorrido de siempre."""
    frame = _frame_ausencias()
    if frame is not None:
        el, info = _jab_buscar(timeout=min(timeout, 15), root=frame, **kw)
        if info:
            return el, info
    log("AVISO: no encontre el control dentro de la ficha; recorro todo el arbol.")
    return _jab_buscar(timeout=timeout, **kw)


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


def _siape_al_frente():
    """True si la ventana activa es SiAPe. Si no, un tipeo/tecla cae en la ventana que
    este usando la persona (12/10: con alguien usando la PC el login tipeaba afuera)."""
    try:
        import win32gui
        import win32process
        fg = win32gui.GetForegroundWindow()
        titulo = win32gui.GetWindowText(fg) or ""
        if VENTANA_SIAPE.lower() in titulo.lower():
            return True
        # el login / los modales de Java pueden tener otro titulo: vale si es del mismo proceso
        pid = win32process.GetWindowThreadProcessId(fg)[1]
        return pid in _pids_siape()
    except Exception:
        return False


def _exigir_siape_al_frente(que):
    for _ in range(3):
        if _siape_al_frente():
            return
        w = _buscar_ventana_siape()
        if w:
            _activar_ventana(w)
        time.sleep(1)
    raise RuntimeError(f"SiAPe no esta al frente (alguien usando la PC?): no {que}")


def _escribir_en_campo(info, texto):
    """Click en el campo por bounds y tipeo. Oracle Forms no acepta setTextContents."""
    _exigir_siape_al_frente("tipeo")
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
    _cerrar_siape_al_salir()
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
            log("No reconozco la pantalla de SiAPe; espero (sin cortar) a que cargue...")
        # SIN corte rapido: espero hasta el timeout general (abajo) por si SIAPE
        # tarda en cargar la pantalla post-login. El limite lo pone el `while` de
        # arriba (SIAPE_SESION_TIMEOUT).
        limite_desc = int(os.environ.get("SIAPE_DESCONOCIDO_MAX", "100000") or "100000")
        if desconocidos > limite_desc:
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


# Calibracion de click, cacheada por proceso. La escala fisica real de la
# ventana de SiAPe NO es constante entre sesiones (se confirmo en vivo el
# 2026-09-25: la misma formula w.width/1296.0 dio 1.5 un dia y ~1.25 otro dia,
# pero la escala REAL necesaria ese segundo dia era ~1.0 con offset -8 en Y -
# virtualizacion de DPI de Windows sobre esta ventana Java especifica, no
# arreglable con una formula fija). offset_x/offset_y son correcciones
# EMPIRICAS que se ajustan solas la primera vez que un click verificado
# (`_jab_click_bounds_verificado`) detecta que fallo. Ver
# `siape_mapping_exportaciones_2026-09-22.md` seccion "Hallazgo 2026-09-25".
_CLICK_CAL = {"offset_x": 0.0, "offset_y": 0.0}


# Escala medida por sesion (05/10/2026): marco raiz que informa JAB vs rectangulo
# real de la ventana. La formula fija w/1296 x h/736 solo vale con la ventana en
# ese tamanio: en 1376x788 multiplicaba x1.07 y los clicks caian una fila abajo
# (el exportador abrio "Novedades Rechazadas" en vez de "Novedades Por Periodo").
# Se recalcula cuando la ventana cambia de lugar/tamanio.
_ESCALA_JAB = {"clave": None, "valor": None}


def _escala_medida(w):
    clave = (w.left, w.top, w.width, w.height)
    if _ESCALA_JAB["clave"] == clave:
        return _ESCALA_JAB["valor"]
    valor = None
    try:
        for _el, depth, info in _jab_walk(max_depth=0, max_segundos=5):
            b = info.get("bounds") or {}
            if depth == 0 and b.get("width") and b.get("height"):
                sx, sy = w.width / b["width"], w.height / b["height"]
                valor = (sx, sy, w.left - b.get("x", 0) * sx, w.top - b.get("y", 0) * sy)
                log(f"Escala de clicks medida: ventana {w.width}x{w.height} @({w.left},{w.top}) / "
                    f"JAB {b['width']}x{b['height']} @({b.get('x')},{b.get('y')}) -> {sx:.3f}x{sy:.3f}")
            break
    except Exception as e:
        log(f"AVISO: no pude medir la escala de clicks ({e}); uso la formula fija.")
    _ESCALA_JAB.update(clave=clave, valor=valor)
    return valor


def _click_transform():
    """Devuelve (scale_x, scale_y, origen_x, origen_y) para convertir bounds
    logicos de JAB a pixeles fisicos de pantalla, con la correccion empirica
    acumulada (si hubo alguna) sumada al origen."""
    w = _buscar_ventana_siape()
    medida = _escala_medida(w) if (w and w.width and w.height) else None
    if medida:
        scale_x, scale_y, ox, oy = medida
        origen_x = ox + _CLICK_CAL["offset_x"]
        origen_y = oy + _CLICK_CAL["offset_y"]
    elif w and w.width and w.height:
        scale_x = w.width / 1296.0
        scale_y = w.height / 736.0
        origen_x = w.left + _CLICK_CAL["offset_x"]
        origen_y = w.top + _CLICK_CAL["offset_y"]
    else:
        scale_x = scale_y = SIAPE_JAB_SCALE
        origen_x = _CLICK_CAL["offset_x"]
        origen_y = _CLICK_CAL["offset_y"]
    return scale_x, scale_y, origen_x, origen_y


def _jab_bounds_center(info):
    bounds = info.get("bounds") or {}
    scale_x, scale_y, origen_x, origen_y = _click_transform()
    cx = bounds.get("x", 0) + bounds.get("width", 0) / 2
    cy = bounds.get("y", 0) + bounds.get("height", 0) / 2
    return (int(origen_x + cx * scale_x), int(origen_y + cy * scale_y))


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


def _jab_click_bounds_verificado(info, nombre_esperado, role="text", timeout=6):
    """Como `_jab_click_bounds`, pero verifica por JAB que el elemento que
    quedo con foco ('enfocado') es realmente `nombre_esperado`. Si cayo en
    otro (tipico: la escala esta mal calculada ese dia), calcula la
    correccion en Y a partir del bound real donde cayo el foco vs el bound
    esperado, la guarda en `_CLICK_CAL` (para TODOS los clicks siguientes de
    este proceso) y reintenta una vez. Devuelve True si termino enfocado en
    el elemento correcto."""
    bounds_objetivo = info.get("bounds") or {}
    for intento in range(2):
        _jab_click_bounds(info)
        time.sleep(PAUSA_CORTA)
        foco_info = None
        for _el, _depth, cand in _jab_walk(max_depth=24, max_segundos=timeout):
            if "enfocado" in (cand.get("states") or []):
                foco_info = cand
                break
        nombre_foco = (foco_info or {}).get("name") or ""
        if nombre_foco.strip() == nombre_esperado.strip():
            return True
        if intento == 0 and foco_info:
            bounds_foco = foco_info.get("bounds") or {}
            y_objetivo = bounds_objetivo.get("y")
            y_foco = bounds_foco.get("y")
            if y_objetivo is not None and y_foco is not None and y_foco != y_objetivo:
                _, _scale_y, _ox, _oy = _click_transform()
                delta_logico = y_objetivo - y_foco
                _CLICK_CAL["offset_y"] += delta_logico * _scale_y
                log(
                    f"AVISO: click cayo en '{nombre_foco}' en vez de '{nombre_esperado}'; "
                    f"corrijo offset_y en {delta_logico * _scale_y:+.1f}px y reintento."
                )
                continue
        break
    return False


def _jab_set_text_by_bounds(info, value):
    _exigir_siape_al_frente("tipeo")
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


SQL_TABLA_DIAS = """
CREATE TABLE IF NOT EXISTS `siape_carga_dias` (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reconocimiento_id INT NOT NULL,
  dni VARCHAR(20) NOT NULL,
  fecha DATE NOT NULL,
  estado ENUM('CARGADO','YA_EXISTIA','ERROR') NOT NULL,
  categoria VARCHAR(40) NULL,
  detalle VARCHAR(500) NULL,
  intentos INT NOT NULL DEFAULT 0,
  creado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_siape_carga_dias_dni_fecha (dni, fecha),
  KEY ix_siape_carga_dias_rec (reconocimiento_id),
  KEY ix_siape_carga_dias_estado (estado, categoria),
  CONSTRAINT fk_siape_carga_dias_rec FOREIGN KEY (reconocimiento_id)
    REFERENCES reconocimientos_medicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
"""

ESTADOS_LISTOS = ("CARGADO", "YA_EXISTIA")


# Lo que el robot BORRA de SiAPe para poner el franco (se anota ANTES de borrar).
SQL_TABLA_REEMPLAZOS = """
CREATE TABLE IF NOT EXISTS `siape_carga_reemplazos` (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reconocimiento_id INT NOT NULL,
  dni VARCHAR(20) NOT NULL,
  fecha DATE NOT NULL,
  tipo_anterior VARCHAR(150) NOT NULL,
  estado ENUM('PENDIENTE','CAMBIADO','BORRADO','FALLO') NOT NULL DEFAULT 'PENDIENTE',
  detalle VARCHAR(500) NULL,
  creado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_siape_carga_reemplazos_dni_fecha (dni, fecha),
  KEY ix_siape_carga_reemplazos_rec (reconocimiento_id),
  CONSTRAINT fk_siape_carga_reemplazos_rec FOREIGN KEY (reconocimiento_id)
    REFERENCES reconocimientos_medicos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
"""

# Si el dia ya tiene otra novedad en AUSENCIAS Y PRESENTES (p.ej. AUSENTE SIN AVISO del
# jefe) se borra y se pone el franco (regla del usuario 12/10: todo se reemplaza).
SIAPE_REEMPLAZAR = os.environ.get("SIAPE_REEMPLAZAR", "true").strip().lower() not in ("0", "false", "no")


def asegurar_tabla_dias(cn):
    with cn.cursor() as cur:
        cur.execute(SQL_TABLA_DIAS)
        cur.execute(SQL_TABLA_REEMPLAZOS)
    cn.commit()


def anotar_reemplazo(cn, rec_id, dni, dia, tipo_anterior):
    with cn.cursor() as cur:
        cur.execute("""INSERT INTO siape_carga_reemplazos (reconocimiento_id, dni, fecha, tipo_anterior)
                       VALUES (%s, %s, %s, %s)""", (rec_id, str(dni), dia, tipo_anterior[:150]))
        rid = cur.lastrowid
    cn.commit()
    return rid


def cerrar_reemplazo(cn, rid, estado, detalle=None):
    with cn.cursor() as cur:
        cur.execute("UPDATE siape_carga_reemplazos SET estado=%s, detalle=%s WHERE id=%s",
                    (estado, (detalle or "")[:500] or None, rid))
    cn.commit()


def estados_dias(cn, dni):
    """{fecha: (estado, intentos)} de lo ya anotado para el agente (cualquier registro)."""
    with cn.cursor() as cur:
        cur.execute("SELECT fecha, estado, intentos FROM siape_carga_dias WHERE dni = %s", (str(dni),))
        return {f["fecha"]: (f["estado"], f["intentos"]) for f in cur.fetchall()}


def dia_a_intentar(estados, dia):
    estado, intentos = estados.get(dia, (None, 0))
    if estado in ESTADOS_LISTOS:
        return False
    return not (estado == "ERROR" and intentos >= SIAPE_MAX_INTENTOS)


def categorizar(motivo):
    """(estado, categoria) a partir del motivo que devuelve la carga del dia."""
    t = (motivo or "").lower()
    if "aviso de otro dia" in t:
        return "ERROR", "AVISO_VIEJO"
    if "bloqueado" in t or "reservar el registro" in t:
        return "ERROR", "BLOQUEADO"
    if "no pude cambiar" in t or "no borro" in t or "consulta no dejo" in t or "grilla no muestra" in t:
        return "ERROR", "REEMPLAZO"
    if "ya existia" in t or "ya existe" in t:
        return "YA_EXISTIA", "YA_EXISTE"
    if "ingresar la fecha" in t:
        return "ERROR", "FALTA_FECHA"
    if "ingresar un tipo" in t:
        return "ERROR", "TIPO_VACIO"          # el combo parecia elegido pero Forms no lo tomo
    if "datos en blanco" in t:
        return "ERROR", "DATOS_EN_BLANCO"
    if "combo" in t:
        return "ERROR", "COMBO_TIPO"
    if "no confirmo" in t:
        return "ERROR", "SIN_CONFIRMAR"
    if "superpone" in t or "carpeta" in t or "licencia" in t:
        return "ERROR", "SUPERPOSICION"
    if "ficheros" in t or "agente" in t or "ventana" in t:
        return "ERROR", "NO_ABRIO_AGENTE"
    return "ERROR", "OTRO"


# Fallas del robot (no abrio el agente, no quedo al frente, el combo no tomo...): se
# anotan pero NO gastan intento. Solo un rechazo real de SiAPe cuenta para el tope.
# AGENTE_NO_ENCONTRADO = SiAPe no lo tiene (ni por DNI ni por nombre): queda agotado de una.
ERRORES_ROBOT = {"NO_ABRIO_AGENTE", "SIN_CONFIRMAR", "COMBO_TIPO", "TIPO_VACIO",
                 "DATOS_EN_BLANCO", "FALTA_FECHA", "AVISO_VIEJO", "BLOQUEADO", "REEMPLAZO"}


def registrar_dia(cn, rec_id, dni, dia, estado, categoria=None, detalle=None, cuenta=None):
    """Upsert por dni+fecha. Suma intento solo un ERROR que sea rechazo de SiAPe
    (cuenta=None decide por categoria; False fuerza a no contar; "agotar" lo deja
    en el tope para que no se reintente solo)."""
    if cuenta is None:
        cuenta = estado == "ERROR" and categoria not in ERRORES_ROBOT
    if cuenta == "agotar":
        nuevo, upd = SIAPE_MAX_INTENTOS, "GREATEST(intentos, %s)"
        val = SIAPE_MAX_INTENTOS
    else:
        nuevo = val = 1 if cuenta else 0
        upd = "intentos + %s"
    with cn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO siape_carga_dias
                   (reconocimiento_id, dni, fecha, estado, categoria, detalle, intentos)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE
                   reconocimiento_id = VALUES(reconocimiento_id),
                   estado = VALUES(estado),
                   categoria = VALUES(categoria),
                   detalle = VALUES(detalle),
                   intentos = {upd}""",
            (rec_id, str(dni), dia, estado, categoria, (detalle or "")[:500] or None, nuevo, val),
        )
    cn.commit()


def cerrar_registro_si_completo(cn, r, cargados_ahora=0):
    """
    procesado=1 solo si TODOS los dias del rango quedaron CARGADO/YA_EXISTIA.
    Si no, deja el resumen de errores en errores_carga y el registro sigue pendiente.
    """
    estados = estados_dias(cn, r["dni"])
    dias = dias_corridos(r["fecha_desde"], r["fecha_hasta"])
    errores = [d for d in dias if estados.get(d, (None, 0))[0] not in ESTADOS_LISTOS]
    if not errores:
        marcar_procesado(cn, r["id"], [])
        log("   -> todos los dias listos. procesado=1")
        MN.registrar_item("siape_carga_francos", r["dni"], r.get("nombre"), r.get("tipo") or "FRANCO",
                          f"{r['fecha_desde']:%d/%m/%Y}", f"{r['fecha_hasta']:%d/%m/%Y}", "ok",
                          f"{len(dias)} día(s) listos ({cargados_ahora} cargado(s) en esta corrida)")
        return True

    with cn.cursor() as cur:
        cur.execute(
            """SELECT fecha, estado, categoria, intentos FROM siape_carga_dias
                WHERE dni = %s AND fecha BETWEEN %s AND %s AND estado = 'ERROR'""",
            (str(r["dni"]), r["fecha_desde"], r["fecha_hasta"]),
        )
        filas = cur.fetchall()
        resumen = "; ".join(f"{f['fecha']:%d/%m/%Y} {f['categoria']} ({f['intentos']}x)" for f in filas)
        sin_intentar = len(errores) - len(filas)
        if sin_intentar:
            resumen = (resumen + "; " if resumen else "") + f"{sin_intentar} día(s) sin intentar"
        cur.execute("UPDATE reconocimientos_medicos SET errores_carga = %s WHERE id = %s",
                    (resumen[:60000] or None, r["id"]))
    cn.commit()
    agotados = [f for f in filas if f["intentos"] >= SIAPE_MAX_INTENTOS]
    log(f"   -> faltan {len(errores)} dia(s); sigue pendiente"
        + (f" ({len(agotados)} con errores agotados, revisar a mano)" if agotados else ""))
    if agotados and len(agotados) == len(errores):
        MN.registrar_item("siape_carga_francos", r["dni"], r.get("nombre"), r.get("tipo") or "FRANCO",
                          f"{r['fecha_desde']:%d/%m/%Y}", f"{r['fecha_hasta']:%d/%m/%Y}", "error",
                          f"errores agotados: {resumen}")
    return False


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
        # "No se ha podido reservar el registro... ¿seguir intentandolo?": con Si se
        # quedaba reintentando para siempre (12/10, 54 intentos). Se contesta No.
        pref = ("No", "NO", "No ALT N") if "reservar el registro" in texto.lower() else None
        if not (cerrar_dialogo_jab(preferidos=pref) if pref else cerrar_dialogo_jab()):
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


def volver_a_ficheros():
    """Si la ficha del agente esta abierta, la cierra con 'Volver a Ficheros'.

    Sin esto, al pasar al agente siguiente la ficha seguia ENCIMA de Ficheros:
    _en_ficheros() daba True igual (FILTRAR sigue en el arbol), se tipeaba en la
    ficha y la fila leida era la del agente anterior ("La fila de Ficheros dice
    'FARFAN...' y yo buscaba 'CICARDI...'"). A "¿guardar cambios?" se contesta NO:
    cada dia bueno ya se guardo con confirmacion; lo pendiente es el resto de un
    dia rechazado. Devuelve True si cerro la ficha."""
    fe = _frame_ausencias(max_segundos=15)
    if fe is None:
        return False
    _b, info = _jab_buscar(nombre="Volver a Ficheros Alt V", role="push button", timeout=10, root=fe)
    if not info:
        _b, info = _jab_buscar(desc="Volver a Ficheros Alt V", role="push button", timeout=5, root=fe)
    if not info:
        log("AVISO: no encuentro 'Volver a Ficheros' en la ficha del agente.")
        return False
    _jab_click_bounds(info)
    time.sleep(PAUSA_MEDIA)
    for _ in range(4):
        texto, _bs = leer_dialogo_jab(max_segundos=5)
        if not texto:
            break
        t = " ".join(texto.split()).lower()
        log(f"   aviso al volver a Ficheros: {t[:120]}")
        if "guardar" in t or "cambios" in t:
            cerrar_dialogo_jab(preferidos=("No", "NO", "No ALT N"))
        else:
            cerrar_modales()
        time.sleep(PAUSA_CORTA)
    # Forms deja la ficha y Ficheros los dos 'visibles' (uno encima del otro): lo
    # que dice donde estoy es cual de los dos esta ACTIVO.
    limite = time.time() + 15
    activo = False
    while time.time() < limite and not activo:
        for _el, _d, info in _jab_walk(max_depth=14, max_segundos=8,
                                      podar=lambda i: i.get("role") == "internal frame"):
            if (info.get("role") == "internal frame" and (info.get("name") or "").strip() == "Ficheros"
                    and "activo" in (info.get("states") or [])):
                activo = True
                break
        if not activo:
            time.sleep(1)
    log("   volvi a Ficheros" if activo else "AVISO: Ficheros no quedo activo")
    return activo


def _buscar_agente_en_ficheros_jab(nombre, cuil=None, exigir="apellido"):
    """Busca por apellido/nombre en Ficheros y abre `NOVEDADES` del primer resultado.

    exigir: "apellido" (la fila tiene que contener el apellido), "completo" (la fila
    tiene que ser el nombre completo: con solo el apellido se abrio otra GARCIA) o
    "ninguno" (solo para entrar a una ficha y despues buscar por DNI)."""
    cerrar_modales()
    volver_a_ficheros()          # la ficha del agente anterior tapa Ficheros

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
    if exigir == "ninguno":
        intentos.append("A")         # cualquier ficha sirve para llegar al Buscador por DNI

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
        if exigir == "completo" and _norm_nombre(texto_fila) != _norm_nombre(busqueda):
            raise RuntimeError(
                f"La fila de Ficheros dice '{texto_fila}' y yo buscaba '{busqueda}' (nombre completo). Freno."
            )
        if exigir == "apellido" and apellido and apellido not in texto_fila.upper():
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
FRAME_AUSENCIAS = "Novedades de Ausentismo"


class AgenteNoEncontrado(RuntimeError):
    """SiAPe no tiene al agente (ni por DNI ni por nombre completo): no es falla del robot."""


def _norm_nombre(s):
    return " ".join(str(s or "").upper().replace(",", " ").split())


def _ficha_header(desc):
    """(el, info) del campo de la cabecera de la ficha (APELLIDO y NOMBRE / LEGAJO)."""
    fe = _frame_ausencias(max_segundos=15)
    if fe is None:
        return None, None, None
    for el, _d, info in _jab_walk(root=fe, max_depth=30, max_segundos=15, max_nodes=6000):
        if (info.get("role") == "text" and (info.get("description") or "").strip() == desc
                and _bounds_ok(info)):
            return fe, el, info
    return fe, None, None


def _nombre_ficha():
    _fe, el, _info = _ficha_header("APELLIDO y NOMBRE")
    return _jab_read_text(el).strip() if el else ""


def _abrir_buscador_desde_ficha():
    """
    Con la ficha de un agente abierta, el `...` al lado de LEGAJO abre el 'Buscador de
    Personas' (el mismo que usa el robot de bajas). Devuelve (frame_el, frame_info) o
    (None, None) si no hay ficha o no se abrio.
    """
    fe, _el, legajo = _ficha_header("LEGAJO")
    if fe is None or not legajo:
        return None, None
    ly, lx = legajo["bounds"]["y"], legajo["bounds"]["x"]
    puntos = [info for _e, _d, info in _jab_walk(root=fe, max_depth=30, max_segundos=15, max_nodes=6000)
              if info.get("role") == "push button" and (info.get("name") or "").strip() == "..."
              and _bounds_ok(info) and abs(info["bounds"]["y"] - ly) <= 8 and info["bounds"]["x"] > lx]
    if not puntos:
        log("AVISO: no encuentro el '...' de LEGAJO en la ficha.")
        return None, None
    _jab_click_bounds(min(puntos, key=lambda i: i["bounds"]["x"]))
    time.sleep(PAUSA_LARGA)
    for _ in range(3):
        texto, _bs = leer_dialogo_jab(max_segundos=5)
        if not texto:
            break
        t = " ".join(texto.split()).lower()
        log(f"   aviso al abrir el Buscador: {t[:120]}")
        if "guardar" in t or "cambios" in t:
            cerrar_dialogo_jab(preferidos=("No", "NO", "No ALT N"))
        else:
            # "No puede dejar Datos en blanco" & cia: la ficha quedo sucia, no sigo
            cerrar_modales()
            return None, None
        time.sleep(PAUSA_CORTA)
    return _jab_buscar(empieza="Buscador de Personas", role="internal frame", timeout=20)


def _buscador_personas_por_dni(frame_el, dni):
    """
    Buscador de Personas abierto -> Documento -> DNI -> BUSCAR -> fila 1 (verifica el
    DNI) -> ACEPTAR. Misma mecanica que cargar_bajas_siape.buscar_agente (probada en
    vivo 05-06/10). Devuelve el APELLIDO Y NOMBRE de la fila elegida.
    """
    dni = str(dni)
    controles = [info for _el, _d, info in _jab_walk(max_depth=20, root=frame_el, max_segundos=20)
                 if _bounds_ok(info)]
    radio_doc = next((c for c in controles if c.get("role") == "radio button"
                      and "documento" in (c.get("name") or c.get("description") or "").lower()), None)
    if not radio_doc:
        raise RuntimeError("No encuentro la opcion 'Documento' del Buscador de Personas.")
    _jab_click_bounds(radio_doc)
    time.sleep(PAUSA_CORTA)

    ry = radio_doc["bounds"]["y"]
    fila_doc = [c for c in controles if c.get("role") == "text"
                and abs(c["bounds"]["y"] - ry) <= 15 and c["bounds"]["x"] > radio_doc["bounds"]["x"]]
    if not fila_doc:
        raise RuntimeError("No encuentro el campo del numero de documento en el Buscador.")
    _jab_set_text_by_bounds(max(fila_doc, key=lambda c: c["bounds"]["x"]), dni)

    btn = next((c for c in controles if c.get("role") == "push button"
                and (c.get("name") or "").strip().upper() == "BUSCAR"), None)
    if not btn:
        raise RuntimeError("No encuentro el BUSCAR del Buscador de Personas.")
    _jab_click_bounds(btn)
    time.sleep(PAUSA_LARGA)
    texto, _ = leer_dialogo_jab(max_segundos=6)
    if texto:
        cerrar_modales()
        limpio = " ".join(texto.split())
        if any(s in limpio.lower() for s in ("no se encontr", "no existe", "no hay", "sin datos", "no devolvi")):
            raise AgenteNoEncontrado(f"DNI {dni}: SiAPe dice '{limpio[:150]}'")
        raise RuntimeError(f"SiAPe aviso en el Buscador: {limpio[:200]}")

    celdas = []
    for intento in range(3):
        fe, _fi = _jab_buscar(empieza="Buscador de Personas", role="internal frame", timeout=15)
        for el, _d, info in _jab_walk(max_depth=20, root=fe or frame_el, max_segundos=45):
            if info.get("role") == "text" and _bounds_ok(info) and info["bounds"]["y"] > ry + 40:
                celdas.append((info["bounds"]["y"], info["bounds"]["x"], el, info))
        if celdas:
            break
        log(f"   Buscador: grilla sin leer (intento {intento + 1}/3), reintento...")
        time.sleep(PAUSA_LARGA)
    if not celdas:
        raise AgenteNoEncontrado(f"el Buscador no devolvio resultados para el DNI {dni}")
    y0 = min(c[0] for c in celdas)
    primera = sorted([c for c in celdas if abs(c[0] - y0) <= 3], key=lambda c: c[1])
    textos = [_jab_read_text(c[2]).strip() for c in primera]
    log(f"   Buscador fila 1: {' | '.join(textos)}")
    if not any(dni in t.replace(".", "").replace("-", "") for t in textos):
        raise RuntimeError(f"La primera fila del Buscador no es el DNI {dni}: {textos}. Freno.")
    _jab_click_bounds(primera[0][3])
    aceptar = next((c for c in controles if c.get("role") == "push button"
                    and (c.get("name") or "").strip().upper() == "ACEPTAR"), None)
    if not aceptar:
        raise RuntimeError("No encuentro ACEPTAR en el Buscador de Personas.")
    _jab_click_bounds(aceptar)
    time.sleep(PAUSA_LARGA)
    for _ in range(3):
        texto, _ = leer_dialogo_jab(max_segundos=5)
        if not texto:
            break
        t = " ".join(texto.split()).lower()
        if "guardar" in t or "cambios" in t:
            cerrar_dialogo_jab(preferidos=("No", "NO", "No ALT N"))
            continue
        cerrar_modales()
        raise RuntimeError(f"SiAPe aviso al aceptar: {' '.join(texto.split())[:200]}")
    return textos[0] if textos else ""


def seleccionar_agente_por_dni(r):
    """
    Abre la ficha del agente buscandolo por DNI (Buscador de Personas). Ficheros se usa
    solo para entrar a una ficha cualquiera cuando todavia no hay ninguna abierta.
    Por DNI NO se controla el nombre contra la base (regla del usuario): solo que la
    ficha haya pasado a la persona de la fila elegida por DNI.
    """
    frame_el, _fi = _abrir_buscador_desde_ficha()
    if frame_el is None:
        log("   sin ficha abierta: entro por Ficheros para llegar al Buscador por DNI")
        _buscar_agente_en_ficheros_jab(r["nombre"], cuil=r["cuil"], exigir="ninguno")
        frame_el, _fi = _abrir_buscador_desde_ficha()
        if frame_el is None:
            raise RuntimeError("No pude abrir el Buscador de Personas desde la ficha.")
    nombre_fila = _buscador_personas_por_dni(frame_el, r["dni"])
    nombre = _nombre_ficha()
    if _norm_nombre(nombre) != _norm_nombre(nombre_fila):
        raise RuntimeError(f"Elegi '{nombre_fila}' (DNI {r['dni']}) pero la ficha muestra '{nombre}'. Freno.")
    log(f"   agente SIAPE (por DNI {r['dni']}): {nombre}")
    if not _jab_select_tab(TAB_AUSENCIAS):
        _click_abs("tab_ausencias")
    time.sleep(PAUSA_MEDIA)
    cerrar_modales()


def abrir_agente(r):
    """Por DNI; si eso falla, por nombre en Ficheros exigiendo el nombre COMPLETO.
    Si SiAPe no lo tiene ni por DNI ni por nombre -> AgenteNoEncontrado."""
    if SIAPE_BUSCAR_POR_DNI:
        try:
            seleccionar_agente_por_dni(r)
            return "DNI"
        except Exception as e:
            log(f"   por DNI no pude ({e}); pruebo por nombre completo en Ficheros")
    try:
        _buscar_agente_en_ficheros_jab(r["nombre"], cuil=r["cuil"], exigir="completo")
    except RuntimeError as e:
        # Ficheros no lo trae, o trae a OTRA persona con el mismo apellido: se marca y se
        # sigue. Si la fila ni siquiera tiene el apellido buscado es la grilla del agente
        # anterior que no se refresco ("Ficheros no quedo activo"): falla del robot, no se
        # marca (12/10: BOLIG quedo "no esta" por la fila vieja de CAMPOS ALDERETE).
        msg = str(e)
        apellido = (r["nombre"] or "").split()[0].upper() if r.get("nombre") else ""
        if "sin resultado" in msg:
            raise AgenteNoEncontrado(msg)
        if "nombre completo" in msg:
            import re
            m = re.search(r"dice '([^']*)'", msg)
            fila = (m.group(1) if m else "").upper()
            if apellido and apellido in fila.split():
                raise AgenteNoEncontrado(msg)
            raise RuntimeError(f"Ficheros mostro una fila vieja ('{fila}'): {msg}")
        raise
    if not _jab_select_tab(TAB_AUSENCIAS):
        _click_abs("tab_ausencias")
    time.sleep(PAUSA_MEDIA)
    cerrar_modales()
    return "NOMBRE"


def reiniciar_siape(motivo):
    """Cierra SiAPe y vuelve a entrar: unica salida segura de una ficha trabada."""
    log(f"   REINICIO SiAPe: {motivo}")
    try:
        cerrar_siape()
    except Exception as e:
        log(f"AVISO: no pude cerrar SiAPe: {e}")
    _jab_reset_driver()
    _ESCALA_JAB.update(clave=None, valor=None)
    _asegurar_escritorio()
    asegurar_sesion()
    cerrar_modales()


def _asegurar_escritorio():
    """Con el RDP desconectado SiAPe no queda al frente y no se leen los avisos."""
    try:
        from escritorio_activo import asegurar_escritorio_activo
        asegurar_escritorio_activo(log)
    except Exception as e:
        log(f"AVISO: no pude asegurar el escritorio activo: {e}")


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
    combo, combo_info = _jab_buscar_ausencias(role="combo box", desc="TIPO DE AUSENCIA",
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

    def _quedo():
        return next((n for n, sel in _opciones_tipo(combo, combo_info) if sel), None)

    # A) seleccion por JAB (sin teclado ni mouse). Las flechas NO sirven despues del
    #    `+` verde: con el registro nuevo vacio, "abajo" es "registro siguiente" en
    #    Forms y salta "No puede dejar Datos en blanco" (visto 08/10, 2do dia).
    try:
        combo.select(tipo, simulate=False, wait_for_selection=False)
        time.sleep(PAUSA_MEDIA)
        if _quedo() == tipo:
            log("   tipo elegido por seleccion JAB")
            return True
        log(f"   seleccion JAB no quedo (quedo '{_quedo()}')")
    except Exception as e:
        log(f"   seleccion JAB fallo: {e}")
    # B) desplegar la lista (accion JAB), elegir el item y Enter
    try:
        combo._request_focus()
        combo._do_accessible_action(action="togglepopup")
        time.sleep(PAUSA_MEDIA)
        lista = combo.find_element_by_role("list")
        item = lista.find_element_by_name(tipo)
        lista._add_accessible_selection_from_context(item.index_in_parent, lista.accessible_context)
        time.sleep(PAUSA_CORTA)
        pyautogui.press("enter")
        time.sleep(PAUSA_MEDIA)
        if _quedo() == tipo:
            log("   tipo elegido desplegando la lista")
            return True
        log(f"   lista desplegada no quedo (quedo '{_quedo()}')")
        cerrar_modales()
    except Exception as e:
        log(f"   desplegar la lista fallo: {e}")
    # C) flechas (lo de antes): solo anda con la ficha recien abierta

    # Foco en el combo SIN mouse: el click sobre el combo (sobre todo con la ficha
    # reabierta) lo dejaba sin opcion ("quedo en 'None'"). Visto 08/10: cuando el
    # combo ya tenia foco, las flechas andaban siempre.
    def _con_foco():
        try:
            return "enfocado" in (combo.get_element_information().get("states") or [])
        except Exception:
            return False
    if _con_foco():
        log("   combo ya con foco")
    else:
        try:
            combo._request_focus()
            time.sleep(PAUSA_MEDIA)
        except Exception as e:
            log(f"   request_focus del combo fallo ({e})")
        if _con_foco():
            log("   foco al combo por JAB")
        else:
            log("   AVISO: el combo no tomo foco por JAB; pruebo click")
            _jab_click_bounds(combo_info)
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


# Catalogo de campos (siape_catalogo/ + siape_campos.py): ubica los campos de la ficha
# por `description` JAB + posicion RELATIVA al frame, sin bandas ni coordenadas de
# pantalla. Si no esta o no encuentra algo, se cae a la busqueda de siempre.
PANT_AUSENCIAS = "Novedades de Ausentismo :: pestana AUSENCIAS Y PRESENTES"
_CAMPOS_CAT = {}


def _campos_ausencias_catalogo():
    """{etiqueta: (el, info)} de TIPO DE AUSENCIA, FECHA y JUSTIFICADO. en un solo recorrido."""
    _CAMPOS_CAT.clear()
    try:
        import siape_campos as SC
        fel = _frame_ausencias()
        if fel is None:
            return _CAMPOS_CAT
        r = SC.varios(PANT_AUSENCIAS, [("TIPO DE AUSENCIA", "combo box", 1), ("FECHA", "text", 1),
                                       ("JUSTIFICADO.", "check box", 1)],
                      frame=(fel, fel.get_element_information()))
        _CAMPOS_CAT.update({k: v for k, v in r.items() if v[1]})
        faltan = [k for k, v in r.items() if not v[1]]
        log(f"   catalogo: {len(_CAMPOS_CAT)}/3 campos" + (f" (faltan {', '.join(faltan)})" if faltan else ""))
    except Exception as e:
        log(f"AVISO: catalogo de campos no disponible ({e}); uso la busqueda vieja.")
    return _CAMPOS_CAT


def _tildar_justificado(frame=None):
    campo, info = _CAMPOS_CAT.get("JUSTIFICADO.", (None, None))
    if campo is not None:
        try:
            info = campo.get_element_information()   # estado ACTUAL, no el del recorrido
        except Exception:
            campo, info = None, None
    if not campo:
        campo, info = _jab_buscar_ausencias(nombre="JUSTIFICADO.", role="check box",
                                         timeout=15, banda_y=(250, 290))
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


_MESES_SIAPE = {"ENE": 1, "JAN": 1, "FEB": 2, "MAR": 3, "ABR": 4, "APR": 4, "MAY": 5, "JUN": 6,
                "JUL": 7, "AGO": 8, "AUG": 8, "SEP": 9, "SET": 9, "OCT": 10, "NOV": 11, "DIC": 12, "DEC": 12}


def _fecha_de_aviso(texto):
    """'... para el dia 29-MAR-2026.' -> date(2026, 3, 29) (None si no trae fecha)."""
    import re
    m = re.search(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})", texto or "")
    if not m or m.group(2).upper() not in _MESES_SIAPE:
        return None
    try:
        return date(int(m.group(3)), _MESES_SIAPE[m.group(2).upper()], int(m.group(1)))
    except ValueError:
        return None


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
        if "reservar el registro" in t:
            cerrar_dialogo_jab(preferidos=("No", "NO", "No ALT N"))
            cerrar_modales()
            return False, f"{dia:%d/%m/%Y}: registro bloqueado por otra sesion de SiAPe"
        if "ya existe" in t:
            fecha_aviso = _fecha_de_aviso(limpio)
            if fecha_aviso and fecha_aviso != dia:
                # Aviso trabado de un dia anterior: NO dice nada de este dia. Darlo por
                # "ya existia" marcaba dias sin cargar (12/10: 30/03..05/04 con el del 29-MAR).
                cerrar_modales()
                return False, (f"{dia:%d/%m/%Y}: aviso de otro dia ({fecha_aviso:%d/%m/%Y}); "
                               "SiAPe quedo trabado, no se sabe si este dia existe")
            motivo = "ya existia una ausencia ese dia"
        cerrar_modales()
        return False, f"{dia:%d/%m/%Y}: {motivo}"
    return False, f"{dia:%d/%m/%Y}: no pude cerrar los avisos de SiAPe"


def _foco_ficha(max_segundos=12):
    """Control con foco dentro de la ficha (DIAG para el 2do dia en la misma ficha)."""
    fe = _frame_ausencias(max_segundos=10)
    if fe is None:
        return None
    for _el, _d, info in _jab_walk(root=fe, max_depth=30, max_segundos=max_segundos, max_nodes=6000):
        if "enfocado" in (info.get("states") or []) and info.get("role") not in ("internal frame", "panel"):
            return info
    return None


def _log_foco(cuando):
    i = _foco_ficha()
    if i:
        log(f"   [foco {cuando}] {i.get('role')} | desc='{(i.get('description') or '').strip()}' "
            f"| name='{(i.get('name') or '').strip()[:40]}' | {i.get('bounds')}")
    else:
        log(f"   [foco {cuando}] (ninguno dentro de la ficha)")


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
        combo, combo_info = _campos_ausencias_catalogo().get("TIPO DE AUSENCIA", (None, None))
        if combo:
            return combo, combo_info
        combo, combo_info = _jab_buscar_ausencias(role="combo box", desc="TIPO DE AUSENCIA",
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
    _log_foco("antes del combo")

    if not _elegir_tipo_ausencia_jab(combo, combo_info, TIPO_AUSENCIA):
        quedo = next((n for n, sel in _opciones_tipo(combo, combo_info) if sel), None)
        # NO `+` ni cerrar_modales(): a "¿Desea guardar los cambios?" contestan Si y
        # podian guardar el registro con otro tipo. Se sale a Ficheros contestando No.
        volver_a_ficheros()
        return False, (f"{dia:%d/%m/%Y}: no pude dejar el combo en '{TIPO_AUSENCIA}' "
                       f"(quedo en '{quedo}'); no guardo")
    log(f"   TIPO DE AUSENCIA = {TIPO_AUSENCIA}")

    _fecha, fecha_info = _CAMPOS_CAT.get("FECHA", (None, None))
    if not fecha_info:
        _fecha, fecha_info = _jab_buscar_ausencias(nombre="FECHA", role="text", timeout=20,
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


def _boton_barra(desc):
    """Boton de la barra de herramientas de Forms (arriba de todo) por description."""
    _el, info = _jab_buscar(desc=desc, role="push button", timeout=15, y_max=90)
    return info


def leer_grilla_ausencias():
    """[(fecha_txt, tipo_txt, info_celda_fecha)] de la grilla FECHA | TIPO DE AUSENCIA de la ficha.
    (El campo FECHA de arriba tambien tiene description FECHA: se deja afuera por x.)"""
    fe = _frame_ausencias(max_segundos=15)
    if fe is None:
        return []
    x0 = (fe.get_element_information().get("bounds") or {}).get("x", 0)
    fechas, tipos = [], []
    for el, _d, info in _jab_walk(root=fe, max_depth=30, max_segundos=25, max_nodes=8000):
        if info.get("role") != "text" or not _bounds_ok(info):
            continue
        d = (info.get("description") or "").strip()
        if d == "FECHA" and info["bounds"]["x"] - x0 < 200:
            fechas.append((info["bounds"]["y"], _jab_read_text(el).strip(), info))
        elif d == "TIPO DE AUSENCIA":
            tipos.append((info["bounds"]["y"], _jab_read_text(el).strip()))
    filas = []
    for y, f, info in sorted(fechas, key=lambda t: t[0]):
        tipo = next((t for ty, t in tipos if abs(ty - y) <= 4), "")
        if f:
            filas.append((f, tipo, info))
    return filas


def _contestar_avisos(si=("Si", "Sí"), no=("No", "NO", "No ALT N"), vueltas=4):
    """Contesta los avisos encadenados: '¿guardar cambios?' -> No, confirmaciones -> Si.
    Devuelve los textos vistos."""
    vistos = []
    for _ in range(vueltas):
        texto, _bs = leer_dialogo_jab(max_segundos=5)
        if not texto:
            break
        limpio = " ".join(texto.split())
        vistos.append(limpio)
        t = limpio.lower()
        if "reservar el registro" in t:
            cerrar_dialogo_jab(preferidos=no)     # bloqueado por otra sesion: no insistir
        elif "guardar" in t and "cambios" in t:
            cerrar_dialogo_jab(preferidos=no)
        else:
            cerrar_dialogo_jab(preferidos=si + ("Aceptar", "OK", "Continuar"))
        time.sleep(PAUSA_MEDIA)
    return vistos


def _fecha_txt(s):
    try:
        d, m, a = (int(x) for x in s.split("/"))
        return date(a, m, d)
    except Exception:
        return None


def ir_a_fecha_grilla(dia, max_vueltas=15):
    """
    Lleva la grilla FECHA | TIPO DE AUSENCIA hasta `dia` como se hace a mano: clic en
    la grilla y flechas arriba/abajo (la grilla viene ordenada de la fecha mas nueva a
    la mas vieja y muestra 6 filas). Devuelve las filas de ese dia (lista vacia si la
    grilla salta de largo ese dia) o None si no pude llegar.
    (12/10: la consulta Enter Query/Re Query NO filtraba la grilla.)
    """
    # "¿Desea guardar los cambios?" -> NO: descarta el registro a medio cargar que deja
    # un "ya existe" (con Si volvia a intentar guardarlo y la grilla no se movia, 12/10).
    _contestar_avisos()
    asegurar_pestana_ausencias()
    filas = leer_grilla_ausencias()
    if not filas:
        return None
    _jab_click_bounds(filas[0][2])               # foco en la grilla
    time.sleep(PAUSA_MEDIA)
    _contestar_avisos()
    ultima_vista = None
    modo = "flechas"
    for _vuelta in range(max_vueltas):
        filas = leer_grilla_ausencias()
        fechas = [_fecha_txt(f) for f, _t, _i in filas]
        fechas_ok = [f for f in fechas if f]
        if not fechas_ok:
            return None
        del_dia = [x for x, f in zip(filas, fechas) if f == dia]
        if del_dia:
            log(f"   grilla en {dia:%d/%m/%Y}: {[(f, t) for f, t, _i in del_dia]}")
            return del_dia
        nueva, vieja = max(fechas_ok), min(fechas_ok)
        log(f"   grilla muestra {vieja:%d/%m/%Y}..{nueva:%d/%m/%Y} ({len(fechas_ok)} filas), busco {dia:%d/%m/%Y}")
        if vieja < dia < nueva:
            return []                             # la grilla pasa de largo: ese dia no hay nada
        vista = tuple(fechas_ok)
        if vista == ultima_vista:
            log(f"   la grilla no se movio con {modo} ({vieja:%d/%m/%Y}..{nueva:%d/%m/%Y}); "
                f"foco en: '{_titulo_foco()}'")
            if modo == "barra":
                return None
            modo = "barra"                        # 12/10 BOLIG: las flechas no movian la grilla
        ultima_vista = vista
        if dia < vieja:
            n, tecla = min(max((vieja - dia).days, 1), 60), "down"
        else:
            n, tecla = min(max((dia - nueva).days, 1), 60), "up"
        if modo == "barra":
            _mover_con_barra(filas, tecla, n)
        else:
            # el foco tiene que quedar en la fila de la punta para que la grilla corra
            _jab_click_bounds(filas[-1][2] if tecla == "down" else filas[0][2])
            time.sleep(PAUSA_CORTA)
            _exigir_siape_al_frente("aprieto flechas")
            for _ in range(n):
                pyautogui.press(tecla)
                time.sleep(0.08)
        time.sleep(PAUSA_MEDIA)
        _contestar_avisos()
    return None


def _titulo_foco():
    try:
        import win32gui
        return win32gui.GetWindowText(win32gui.GetForegroundWindow()) or "(sin ventana al frente)"
    except Exception:
        return "?"


def _desplazar_grilla(filas, tecla, n, est):
    """Corre la grilla n registros: flechas; si ya se vio que no mueven, la barra."""
    if est["modo"] == "barra":
        _mover_con_barra(filas, tecla, n)
    else:
        _jab_click_bounds(filas[-1][2] if tecla == "down" else filas[0][2])
        time.sleep(PAUSA_CORTA)
        _exigir_siape_al_frente("aprieto flechas")
        for _ in range(n):
            pyautogui.press(tecla)
            time.sleep(0.08)
    time.sleep(PAUSA_MEDIA)
    _contestar_avisos()


def mapa_grilla(desde, hasta, max_vueltas=40):
    """
    {fecha: set(tipos)} de la grilla del agente entre `desde` y `hasta`, recorriendola
    UNA vez hacia abajo (viene de la fecha mas nueva a la mas vieja, 6 filas por vista).
    None si no la pude recorrer (se sigue dia por dia como antes).
    """
    _contestar_avisos()
    asegurar_pestana_ausencias()
    filas = leer_grilla_ausencias()
    if not filas:
        return {}
    _jab_click_bounds(filas[0][2])
    time.sleep(PAUSA_MEDIA)
    _contestar_avisos()
    est = {"modo": "flechas"}
    mapa, ultima = {}, None
    for _ in range(max_vueltas):
        filas = leer_grilla_ausencias()
        ok = [(f, t) for f, t in ((_fecha_txt(f), t) for f, t, _i in filas) if f]
        if not ok:
            return None
        for f, t in ok:
            if desde <= f <= hasta:
                mapa.setdefault(f, set()).add(t)
        vieja, nueva = min(f for f, _ in ok), max(f for f, _ in ok)
        log(f"   grilla {vieja:%d/%m/%Y}..{nueva:%d/%m/%Y} (rango {desde:%d/%m/%Y}..{hasta:%d/%m/%Y})")
        if vieja <= desde:
            return mapa
        vista = tuple(f for f, _ in ok)
        if vista == ultima:
            if est["modo"] == "barra":
                log("   la grilla no baja mas: fin de las novedades del agente")
                return mapa
            log(f"   las flechas no movieron la grilla (foco: '{_titulo_foco()}'); uso la barra")
            est["modo"] = "barra"
        ultima = vista
        if vieja > hasta:
            n = min(max((vieja - hasta).days, 1), 60)
        else:
            n = max(len(ok) - 1, 1)        # dentro del rango: una vista menos una fila
        _desplazar_grilla(filas, "down", n, est)
    return None


def _mover_con_barra(filas, tecla, n):
    """Corre la grilla con las flechitas de SU barra de desplazamiento (clics, no teclado)."""
    fe = _frame_ausencias(max_segundos=15)
    c0, c1 = filas[0][2]["bounds"], filas[-1][2]["bounds"]
    y_ini, y_fin = c0["y"] - 30, c1["y"] + c1["height"] + 30
    barras = [info for _e, _d, info in _jab_walk(root=fe, max_depth=30, max_segundos=20, max_nodes=8000)
              if info.get("role") == "scroll bar" and _bounds_ok(info)
              and y_ini <= info["bounds"]["y"] <= c0["y"] + 10
              and info["bounds"]["height"] >= (c1["y"] - c0["y"])
              and c0["x"] + 300 < info["bounds"]["x"] < c0["x"] + 600]
    if not barras:
        log("   no encuentro la barra de desplazamiento de la grilla")
        return
    b = min(barras, key=lambda i: i["bounds"]["x"])["bounds"]
    punta = {"bounds": {"x": b["x"], "width": b["width"], "height": 10,
                        "y": (b["y"] + b["height"] - 10) if tecla == "down" else b["y"]}}
    _exigir_siape_al_frente("clickeo la barra de la grilla")
    log(f"   muevo la grilla con la barra: {n} clic(s) {tecla}")
    for _ in range(n):
        _jab_click_bounds(punta)
        time.sleep(0.15)


def _fecha_ficha_arriba():
    """FECHA del registro actual (los campos de arriba de la ficha)."""
    _campos_ausencias_catalogo()
    el, info = _CAMPOS_CAT.get("FECHA", (None, None))
    if not el:
        el, info = _jab_buscar_ausencias(nombre="FECHA", role="text", timeout=20,
                                         banda_y=(195, 235), x_min=360, x_max=520)
    return _jab_read_text(el).strip() if el else ""


def reemplazar_dia(cn, r, dia, hasta=None, reabrir=None):
    """
    El dia ya tiene una novedad que no es el franco: la anota en siape_carga_reemplazos,
    la borra (X roja + Guardar) y despues carga el franco como siempre.
    Devuelve (ok, motivo, tipo_anterior).
    """
    filas = ir_a_fecha_grilla(dia)
    if filas is None and reabrir is not None:
        # la ficha quedo trabada con el registro rechazado: vuelvo a abrirla limpia
        log("   la grilla no avanza: vuelvo a Ficheros y reabro el agente")
        reabrir()
        filas = ir_a_fecha_grilla(dia)
    if filas is None:
        return False, f"{dia:%d/%m/%Y}: no pude llegar a ese dia en la grilla; no borro nada", None
    if not filas:
        return False, f"{dia:%d/%m/%Y}: SiAPe dijo 'ya existe' pero la grilla no muestra nada ese dia", None
    if len(filas) > 1:
        return False, f"{dia:%d/%m/%Y}: hay {len(filas)} novedades ese dia {[t for _f, t, _i in filas]}; no borro", None
    _f, tipo, celda = filas[0]
    if tipo.upper().startswith("FRANCO COMPENSATORIO"):
        return True, "YA_ERA_FRANCO", tipo
    if hasta == "leer":
        _jab_click_bounds(celda)
        time.sleep(PAUSA_MEDIA)
        log(f"   --hasta leer: el {dia:%d/%m/%Y} tiene '{tipo}'; arriba quedo FECHA="
            f"'{_fecha_ficha_arriba()}'; corto sin cambiar nada")
        return False, "prueba: solo lectura", tipo

    # No se borra nada (indicacion del usuario 12/10): se CAMBIA el tipo del registro
    # existente a franco. Igual se anota antes lo que habia.
    rid = anotar_reemplazo(cn, r["id"], r["dni"], dia, tipo)
    log(f"   anotado cambio #{rid}: {dia:%d/%m/%Y} tenia '{tipo}' -> lo paso a franco")
    try:
        _jab_click_bounds(celda)                 # me paro en el registro de ese dia
        time.sleep(PAUSA_MEDIA)
        cerrar_modales()
        # Control: el registro de arriba TIENE que ser el de ese dia; si no, no toco nada.
        fecha_ficha = _fecha_ficha_arriba()
        if fecha_ficha != dia.strftime("%d/%m/%Y"):
            raise RuntimeError(f"arriba quedo FECHA '{fecha_ficha}', no el {dia:%d/%m/%Y}; no cambio nada")
        combo, combo_info = asegurar_pestana_ausencias()
        if not _elegir_tipo_ausencia_jab(combo, combo_info, TIPO_AUSENCIA):
            raise RuntimeError(f"no pude dejar el combo en '{TIPO_AUSENCIA}'")
        if _fecha_ficha_arriba() != dia.strftime("%d/%m/%Y"):
            raise RuntimeError("al elegir el tipo cambio el registro de arriba; no guardo")
        # JUSTIFICADO no se toca (asi se hace a mano)
        g = _boton_barra("Guardar")
        if not g:
            raise RuntimeError("No encuentro Guardar")
        _jab_click_bounds(g)
        time.sleep(PAUSA_LARGA)
        ok, motivo = _resolver_avisos(dia)
        if not ok:
            raise RuntimeError(motivo)
        if motivo != "GUARDADO":
            filas2 = ir_a_fecha_grilla(dia) or []
            if not any(t.upper().startswith("FRANCO COMPENSATORIO") for _f, t, _i in filas2):
                raise RuntimeError(f"SiAPe no confirmo y la grilla muestra {[(f, t) for f, t, _i in filas2]}")
        cerrar_reemplazo(cn, rid, "CAMBIADO")
    except Exception as e:
        cerrar_reemplazo(cn, rid, "FALLO", str(e))
        cerrar_modales()
        return False, f"{dia:%d/%m/%Y}: no pude cambiar '{tipo}' a franco: {e}", tipo
    return True, f"cambio '{tipo}' a franco", tipo


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
    ap.add_argument("--prueba-reemplazo", metavar="DD/MM/YYYY",
                    help="con --id: va a ese dia de la grilla y reemplaza lo que haya por el franco")
    ap.add_argument("--hasta", choices=["leer", "todo"], default="todo",
                    help="con --prueba-reemplazo: 'leer' solo muestra lo que hay, sin borrar")
    args = ap.parse_args()

    if args.log:
        try:
            _LOG_FH = open(args.log, "a", encoding="utf-8")
        except Exception as e:
            print(f"AVISO: no pude abrir el log {args.log}: {e}")

    cn = conn()
    asegurar_tabla_dias(cn)
    pendientes = traer_pendientes(cn, solo_id=args.id, limit=args.limit)

    desde_arg = None
    if args.from_date:
        desde_arg = date.fromisoformat(
            "-".join(reversed(args.from_date.replace("-", "/").split("/")))
        )

    def dias_del_registro(r):
        """Dias del rango que todavia hay que intentar (lo CARGADO/YA_EXISTIA y los
        errores agotados quedan afuera)."""
        estados = estados_dias(cn, r["dni"])
        dias = [d for d in dias_corridos(r["fecha_desde"], r["fecha_hasta"]) if dia_a_intentar(estados, d)]
        if desde_arg:
            dias = [d for d in dias if d >= desde_arg]
        if args.max_days:
            dias = dias[:args.max_days]
        return dias

    total_dias = sum(len(dias_del_registro(r)) for r in pendientes)
    log(f"{len(pendientes)} registro(s) pendiente(s) - {total_dias} dia(s) a intentar "
        f"(tope {SIAPE_MAX_INTENTOS} intentos por dia)")

    for r in pendientes:
        dias = dias_corridos(r["fecha_desde"], r["fecha_hasta"])
        faltan = len(dias_del_registro(r))
        log(f"  #{r['id']:<4} {r['nombre']:<38} CUIL {r['cuil']}  "
            f"{r['fecha_desde']:%d/%m/%Y} a {r['fecha_hasta']:%d/%m/%Y}  ({len(dias)}d, faltan {faltan})")

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
    _asegurar_escritorio()
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

    ficha_sucia = {"v": False}
    no_encontrados = {}              # dni -> motivo: ya dio "no esta en SiAPe" en esta corrida
    for r in pendientes:
        log(f"-- #{r['id']} {r['nombre']} ---------------------")
        dias_a_cargar = dias_del_registro(r)
        if not dias_a_cargar and not args.solo_abrir:
            log("   nada para intentar (todo cargado/ya existia o errores agotados); no abro el agente.")
            cerrar_registro_si_completo(cn, r)
            continue
        if str(r["dni"]) in no_encontrados and not args.solo_abrir:
            # cada busqueda fallida cuesta un reinicio (~4 min): no se repite en la corrida
            log("   este DNI ya dio 'no esta en SiAPe' en esta corrida; lo marco sin buscarlo")
            for dia in dias_a_cargar:
                registrar_dia(cn, r["id"], r["dni"], dia, "ERROR", "AGENTE_NO_ENCONTRADO",
                              no_encontrados[str(r["dni"])], cuenta="agotar")
            cerrar_registro_si_completo(cn, r)
            continue

        def _abrir():
            if usar_agente_ausencias:
                return abrir_agente(r)
            if usar_compensatorios:
                seleccionar_agente_compensatorios(r["cuil"], r["nombre"])
            else:
                seleccionar_agente(r["cuil"], origen)
            return "NOMBRE"

        if ficha_sucia["v"]:
            # Un dia a medio cargar deja la ficha trabada ("No puede dejar Datos en
            # blanco") y arrastraba a TODOS los agentes siguientes. Se arranca de cero.
            reiniciar_siape("la ficha anterior quedo con un registro a medio cargar")
            ficha_sucia["v"] = False
        def _marcar_no_encontrado(e):
            # SiAPe no lo tiene: se marca como definitivo (no se reintenta solo) y sigo.
            log(f"   NO ESTA EN SiAPe: {e} -> lo marco y sigo con el siguiente")
            no_encontrados[str(r["dni"])] = str(e)
            for dia in dias_a_cargar:
                registrar_dia(cn, r["id"], r["dni"], dia, "ERROR", "AGENTE_NO_ENCONTRADO", str(e),
                              cuenta="agotar")
            if SIAPE_BUSCAR_POR_DNI:
                ficha_sucia["v"] = True      # puede haber quedado el Buscador abierto

        try:
            _abrir()
        except AgenteNoEncontrado as e:
            _marcar_no_encontrado(e)
            continue
        except Exception as e:
            log(f"   ERROR abriendo el agente: {e}")
            try:
                reiniciar_siape("no pude abrir el agente")
                _abrir()
            except AgenteNoEncontrado as e2:
                _marcar_no_encontrado(e2)
                continue
            except Exception as e2:
                # Falla del robot, no de SiAPe: se anota pero NO gasta intento.
                log(f"   ERROR abriendo el agente (tras reiniciar): {e2}")
                for dia in dias_a_cargar:
                    registrar_dia(cn, r["id"], r["dni"], dia, "ERROR", "NO_ABRIO_AGENTE", str(e2),
                                  cuenta=False)
                ficha_sucia["v"] = True
                continue

        if args.solo_abrir:
            log("--solo-abrir: llegue a la pantalla del agente y corto sin guardar nada.")
            break

        if args.prueba_reemplazo:
            d_, m_, a_ = (int(x) for x in args.prueba_reemplazo.split("/"))
            dia = date(a_, m_, d_)
            log(f"   PRUEBA reemplazo {dia:%d/%m/%Y} (--hasta {args.hasta})")
            ok, motivo, tipo = reemplazar_dia(cn, r, dia, hasta=args.hasta)
            log(f"   resultado: ok={ok} motivo={motivo} tipo_anterior={tipo}")
            if args.hasta == "todo":
                if ok:
                    registrar_dia(cn, r["id"], r["dni"], dia,
                                  "YA_EXISTIA" if motivo == "YA_ERA_FRANCO" else "CARGADO",
                                  None if motivo == "YA_ERA_FRANCO" else "REEMPLAZO_OK", motivo)
                else:
                    est, cat = categorizar(motivo)
                    registrar_dia(cn, r["id"], r["dni"], dia, est, cat, motivo)
            break

        cargados = salteados = 0
        seguidos_robot = 0              # errores del robot seguidos en este agente
        reinicios = 0

        # La grilla del agente se lee UNA vez para todo el rango (antes se bajaba
        # dia por dia: 2-10 min por dia). Con eso cada dia se decide sin tocar SiAPe
        # si ya es franco, se CAMBIA si tiene otro tipo, y solo se carga si esta vacio.
        mapa = None
        if usar_agente_ausencias and dias_a_cargar:
            try:
                mapa = mapa_grilla(min(dias_a_cargar), max(dias_a_cargar))
            except Exception as e:
                log(f"   no pude leer la grilla del rango ({e}); sigo dia por dia")
                mapa = None
            if mapa is not None:
                log(f"   grilla leida: {len(mapa)} dia(s) del rango ya tienen novedad")

        for dia in dias_a_cargar:
            if mapa is not None and dia in mapa:
                tipos = mapa[dia]
                if any(t.upper().startswith("FRANCO COMPENSATORIO") for t in tipos):
                    registrar_dia(cn, r["id"], r["dni"], dia, "YA_EXISTIA", "YA_EXISTE",
                                  "franco ya cargado (visto en la grilla)")
                    log(f"   SKIP [YA_EXISTE] {dia:%d/%m/%Y}: ya era franco (grilla)")
                    continue
                log(f"   {dia:%d/%m/%Y} tiene {sorted(tipos)} -> lo paso a franco")
                try:
                    ok_r, motivo_r, _tipo = reemplazar_dia(
                        cn, r, dia, reabrir=lambda: (volver_a_ficheros(), abrir_agente(r)))
                except Exception as e:
                    ok_r, motivo_r = False, f"{dia:%d/%m/%Y}: no pude cambiar a franco: {e}"
                if ok_r and motivo_r == "YA_ERA_FRANCO":
                    registrar_dia(cn, r["id"], r["dni"], dia, "YA_EXISTIA", "YA_EXISTE", motivo_r)
                    continue
                if ok_r:
                    cargados += 1
                    seguidos_robot = 0
                    registrar_dia(cn, r["id"], r["dni"], dia, "CARGADO", "REEMPLAZO_OK", motivo_r)
                    log(f"   OK   {dia:%d/%m/%Y} ({motivo_r})")
                    continue
                salteados += 1
                est, cat = categorizar(motivo_r)
                registrar_dia(cn, r["id"], r["dni"], dia, est, cat, motivo_r)
                log(f"   SKIP [{cat}] {motivo_r}")
                ficha_sucia["v"] = True
                continue
            log(f"   cargando {dia:%d/%m/%Y}...")
            try:
                if usar_agente_ausencias:
                    ok, motivo = cargar_dia_ausencia_agente(dia, dialogos)
                elif usar_compensatorios:
                    ok, motivo = cargar_dia_compensatorio_jab(dia, dialogos)
                else:
                    ok, motivo = cargar_dia(dia, origen, dialogos)
                excepcion = False
            except Exception as e:
                ok, motivo, excepcion = False, f"{dia:%d/%m/%Y}: {e}", True
            if ok:
                cargados += 1
                seguidos_robot = 0
                ficha_sucia["v"] = False
                registrar_dia(cn, r["id"], r["dni"], dia, "CARGADO")
                log(f"   OK   {dia:%d/%m/%Y}")
                continue

            estado, categoria = categorizar(motivo)
            if (not excepcion and estado == "YA_EXISTIA" and SIAPE_REEMPLAZAR and usar_agente_ausencias):
                # Ya hay algo ese dia (p.ej. AUSENTE SIN AVISO del jefe): se borra y va el franco.
                try:
                    ok_r, motivo_r, tipo_ant = reemplazar_dia(
                        cn, r, dia, reabrir=lambda: (volver_a_ficheros(), abrir_agente(r)))
                except Exception as e:
                    ok_r, motivo_r, tipo_ant = False, f"{dia:%d/%m/%Y}: no pude cambiar a franco: {e}", None
                if ok_r and motivo_r == "YA_ERA_FRANCO":
                    pass                                  # de verdad ya estaba: YA_EXISTIA
                elif ok_r:
                    cargados += 1
                    seguidos_robot = 0
                    ficha_sucia["v"] = False
                    registrar_dia(cn, r["id"], r["dni"], dia, "CARGADO", "REEMPLAZO_OK", motivo_r)
                    log(f"   OK   {dia:%d/%m/%Y} ({motivo_r})")
                    continue
                else:
                    motivo = motivo_r
                    estado, categoria = categorizar(motivo)
            salteados += 1
            if excepcion and estado != "ERROR":
                estado, categoria = "ERROR", "OTRO"
            registrar_dia(cn, r["id"], r["dni"], dia, estado, categoria, motivo,
                          cuenta=False if excepcion else None)
            log(f"   {'ERROR' if excepcion else 'SKIP'} [{categoria}] {motivo}")
            es_robot = excepcion or categoria in ERRORES_ROBOT
            seguidos_robot = seguidos_robot + 1 if es_robot else 0
            ficha_sucia["v"] = es_robot
            if excepcion or categoria == "AVISO_VIEJO" or seguidos_robot >= 2:
                if reinicios >= 1:
                    log("   ya reinicie una vez en este agente; sigo con el registro siguiente")
                    break
                reinicios += 1
                seguidos_robot = 0
                try:
                    reiniciar_siape(f"{'error' if excepcion else '2 fallas seguidas'} en {r['nombre']}")
                    ficha_sucia["v"] = False
                    _abrir()
                except Exception as e:
                    log(f"   no pude reabrir el agente: {e}")
                    ficha_sucia["v"] = True
                    break

        log(f"   -> {cargados} cargado(s), {salteados} salteado(s).")
        cerrar_registro_si_completo(cn, r, cargados)

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
