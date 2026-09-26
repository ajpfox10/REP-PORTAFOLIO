"""
Carga en SiAPe la ANUAL COMPLEMENTARIA (stress) de `cola_carga_stress`, por
Java Access Bridge. Localiza cada control POR NOMBRE/ROL DENTRO de su frame
(sin caminar el arbol gigante del menu) y lo activa por ACCION del propio
elemento (el.click / el.click(simulate) / request_focus + teclado).
NO usa coordenadas fijas inventadas: cada click sale de los bounds vivos del
elemento que devuelve JAB.

Verifica Año, C.Días y Licencia leyendo el valor real ANTES de guardar.

Uso:
  python cargar_stress_jab.py --dry-run
  python cargar_stress_jab.py --solo-abrir --dni N     # prueba persona->Buscador
  python cargar_stress_jab.py --dni N
  python cargar_stress_jab.py --limit 1
  python cargar_stress_jab.py
"""
import argparse
import sys
import time

import pymysql

import os  # para ubicar mapeo_novedades.py
# detalle por agente para la pagina Robots (script_run_items)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN

import cargar_francos_siape as F
from cargar_francos_siape import (
    log, PAUSA_CORTA, PAUSA_MEDIA, PAUSA_LARGA,
    asegurar_sesion, cerrar_modales, ventana_siape,
    _buscar_ventana_siape, _activar_ventana,
    _jab_walk, _jab_wait_frame, _jab_find_in, _jab_read_text, _jab_driver,
)

try:
    import pyautogui
except ImportError:
    pyautogui = None

DB = F.DB
FRAME_TA = "Administración de Tiempo Acumulado"
FRAME_BUS = "Buscador de Personas"
FRAME_LIC = "Licencias y Permisos"
Y_FILA1 = 299          # primera fila de la grilla (mapeado 2026-09-14 20:21: los
                       # '...' de fila 1 estan en y=299; antes 244 -> no los hallaba)
Y_TOL = 16
USAR_PLUS = False      # --plus: reusar la pantalla con el + verde entre agentes


def _hwnd_siape():
    w = _buscar_ventana_siape()
    return getattr(w, "_hWnd", None) if w else None


def _wm_type(texto, hwnd=None):
    """Tipea por PostMessage(WM_CHAR) directo al handle Java, SIN foco del SO.
    Requiere que el campo ya este enfocado por JAB (request_focus)."""
    import win32api
    import win32con
    if hwnd is None:
        hwnd = _hwnd_siape()
    if not hwnd:
        return False
    # limpiar: HOME + shift no anda por post; mando varios BACKSPACE y DELETE
    for _ in range(20):
        win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_BACK, 0)
        win32api.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_BACK, 0)
    for _ in range(20):
        win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_DELETE, 0)
        win32api.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_DELETE, 0)
    time.sleep(0.1)
    for ch in str(texto):
        win32api.PostMessage(hwnd, win32con.WM_CHAR, ord(ch), 0)
        time.sleep(0.03)
    time.sleep(0.15)
    return True


def _wm_key(vk, scan, hwnd=None):
    """PostMessage de una tecla con lParam BIEN armado (scan code + flags), que
    es lo que Java/Forms necesita para procesarla. Sin foco del SO."""
    import win32api
    import win32con
    if hwnd is None:
        hwnd = _hwnd_siape()
    if not hwnd:
        return
    lp_down = (scan << 16) | 1
    lp_up = (scan << 16) | 1 | (1 << 30) | (1 << 31)
    win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, vk, lp_down)
    time.sleep(0.03)
    win32api.PostMessage(hwnd, win32con.WM_KEYUP, vk, lp_up)
    time.sleep(PAUSA_CORTA)


def _wm_tab(hwnd=None):
    import win32con
    _wm_key(win32con.VK_TAB, 0x0F, hwnd)   # VK_TAB=0x09, scan=0x0F
    time.sleep(PAUSA_CORTA)


def _tipear_wm(el, texto):
    """Enfoca el campo por JAB (request_focus) y tipea por WM_CHAR (sin foco del
    SO). Devuelve True si el valor quedo (leido de vuelta)."""
    if el is None:
        return False
    try:
        el.request_focus()
    except Exception:
        pass
    time.sleep(PAUSA_CORTA)
    _wm_type(texto)
    val = (F._jab_read_text(el) or "").strip()
    return val == str(texto).strip()


def _forzar_frente_seguro(w=None, timeout=8):
    """Trae SIAPE al frente DE VERDAD y confirma (GetForegroundWindow==hwnd).
    Usa minimizar+restaurar, que fuerza el foreground aunque SetForegroundWindow
    este bloqueado para un proceso sin foco. Devuelve True si quedo al frente."""
    import ctypes
    import win32con
    import win32gui
    if w is None:
        w = _buscar_ventana_siape()
    if w is None:
        return False
    hwnd = getattr(w, "_hWnd", None)
    if not hwnd:
        return False
    u = ctypes.windll.user32
    try:
        u.SystemParametersInfoW(0x2001, 0, 0, 0)   # SPI_SETFOREGROUNDLOCKTIMEOUT=0
    except Exception:
        pass
    # NO minimizar: ya NO hace falta (la contraseña ahora es WM_CHAR, independiente del
    # foreground). El min/restore rompia el estado de la ventana -> tras el login el
    # selector no aparecia. Dejo la ventana MAXIMIZADA, igual que cuando el usuario lo
    # hace a mano (asi el selector post-login aparece normal). NADA de ALT.
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
        time.sleep(0.3)
    except Exception:
        pass
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)   # asegurar restaurada
            u.BringWindowToTop(hwnd)
            u.SetForegroundWindow(hwnd)
        except Exception:
            pass
        if u.GetForegroundWindow() == hwnd:
            return True
        time.sleep(0.3)
    try:
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)       # SIEMPRE termina restaurada
    except Exception:
        pass
    return u.GetForegroundWindow() == hwnd


# =================== acciones JAB (sin coordenadas inventadas) ===================
def _click(el, simulate=None):
    """Activa el elemento por su propia accion JAB (o simulate=click en sus bounds vivos)."""
    if el is None:
        return False
    intentos = (False, True) if simulate is None else (simulate,)
    for sim in intentos:
        try:
            el.click(simulate=sim)
            time.sleep(PAUSA_CORTA)
            return True
        except TypeError:
            try:
                el.click(); time.sleep(PAUSA_CORTA); return True
            except Exception:
                pass
        except Exception:
            continue
    return False


def _focus(el):
    """Pone el foco en el campo sin coordenadas: request_focus, o simulate-click."""
    if el is None:
        return False
    try:
        el.request_focus()
        time.sleep(PAUSA_CORTA)
        return True
    except Exception:
        return _click(el, simulate=True)


def _set_valor(el, texto):
    """Escribe en el campo por JAB directo (send_text) — NO depende del foco del
    SO ni del teclado. Devuelve True si el valor quedo (leido de vuelta)."""
    if el is None:
        return False
    try:
        el.send_text(str(texto))
        time.sleep(PAUSA_CORTA)
        if (F._jab_read_text(el) or "").strip() == str(texto).strip():
            return True
    except Exception:
        pass
    return False


def _tipear(el, texto):
    """WM_CHAR directo al handle Java (sin foco del SO). Fallbacks: send_text y
    teclado (este ultimo si necesita foco)."""
    if _tipear_wm(el, texto):
        return
    if _set_valor(el, texto):
        return
    _focus(el)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    pyautogui.press("end")
    pyautogui.press("backspace", presses=30, interval=0.01)
    time.sleep(0.1)
    pyautogui.typewrite(str(texto), interval=0.03)
    time.sleep(PAUSA_CORTA)


_LOGIN_STATE = {"intentado": False}


def _login_robusto():
    """Login de UN SOLO intento, sin loops. Escribe Usuario, salta a Contraseña,
    escribe la pass con TECLADO REAL (WM_CHAR perdia ~2 chars -> entraba corta y
    SIAPE la rechazaba) y aprieta INGRESAR una vez. Si SIAPE la rechaza la pantalla
    vuelve a 'login' y asegurar_sesion nos llamaria de nuevo -> en esa 2da llamada
    levantamos RuntimeError para NO quedar en loop escribiendo usuario+contraseña."""
    if _LOGIN_STATE["intentado"]:
        raise RuntimeError(
            "Login rechazado: ya intente UNA vez y SIAPE sigue en la pantalla de "
            "login (credenciales incorrectas o INGRESAR no tomo). NO reintento para "
            "no quedar en loop. Revisa SIAPE_USER / SIAPE_PASS en el .env.")
    _LOGIN_STATE["intentado"] = True
    if not F.SIAPE_USER or not F.SIAPE_PASS:
        raise RuntimeError("Falta SIAPE_USER o SIAPE_PASS en .env.")
    usr, _u = F._jab_buscar(nombre="Usuario", role="text", timeout=20)
    btn, _b = F._jab_buscar(nombre="INGRESAR", role="push button", timeout=20)
    if not (usr and btn):
        raise RuntimeError("Pantalla de login pero no encuentro Usuario/INGRESAR.")
    log(f"Logueando como {F.SIAPE_USER} (un solo intento)...")
    cerrar_modales()
    hwnd = _hwnd_siape()
    _forzar_frente_seguro()
    u2, _up = F._jab_buscar(nombre="Usuario", role="text", timeout=6)
    p2, _pp = F._jab_buscar(role="password text", timeout=6)
    usr_el = u2 or usr
    # --- Usuario --- (el foco arranca aca; WM_CHAR autolimpia y escribe)
    try:
        usr_el.request_focus()
    except Exception:
        pass
    time.sleep(PAUSA_CORTA)
    _wm_type(F.SIAPE_USER, hwnd)
    # --- foco a Contraseña con TAB nativo (mueve el foco de verdad) + respiro ---
    _wm_tab(hwnd)
    time.sleep(1.0)
    # --- Contraseña por WM_CHAR (PostMessage), IGUAL que el Usuario (que SI entra).
    # pyautogui dejaba la Contraseña VACIA porque SIAPE no quedaba al frente. WM_CHAR
    # no depende del frente ni de la sesion. Lento (0.15/letra) para no perder letras,
    # tras el respiro de 1s post-TAB (el foco ya esta en Contraseña).
    import win32api as _wa
    import win32con as _wc2
    for _ in range(15):                               # limpiar por las dudas
        _wa.PostMessage(hwnd, _wc2.WM_KEYDOWN, _wc2.VK_BACK, 0)
        _wa.PostMessage(hwnd, _wc2.WM_KEYUP, _wc2.VK_BACK, 0)
    time.sleep(0.3)
    for _ch in str(F.SIAPE_PASS):
        _wa.PostMessage(hwnd, _wc2.WM_CHAR, ord(_ch), 0)
        time.sleep(0.15)
    time.sleep(PAUSA_CORTA)
    vu = (F._jab_read_text(usr_el) or "").strip()
    log(f"   listo para INGRESAR: Usuario='{vu}' (pass WM_CHAR lento)")
    # --- INGRESAR: por ACCION JAB del boton (como eRreH), que lo ACTIVA sin depender
    # del pixel ni del foco. El clic fisico en bounds "no fallaba" pero NO activaba el
    # boton -> el form quedaba lleno y quieto. Sumo Enter (el foco esta en Contraseña)
    # y clic fisico como ultimo recurso. Reubico el boton vivo. ---
    b2, _b2 = F._jab_buscar(nombre="INGRESAR", role="push button", timeout=6)
    target = b2 or btn
    if not _click(target):                # accion JAB (simulate=False y si no, True)
        if _b2 is not None:
            try:
                F._jab_click_bounds(_b2)
            except Exception:
                pass
    pyautogui.press("enter")              # submit por teclado (el foco quedo en Contraseña)
    # (1) Espera QUIETA LARGA sin tocar el JAB: engancharse/caminar el arbol durante
    # la transicion post-login crashea el applet. Con el login OK (sesion activa) la
    # transicion SI ocurre -> hay que esperar que el selector quede 100% estable antes
    # de re-enganchar (la corrida que anduvo, 20:07, era selector ya estable).
    time.sleep(35)
    # (1b) RESTAURAR la ventana (una vez, ya estable): el selector abre MINIMIZADO tras
    # el login del robot -> el JAB no lo encuentra por titulo ('no java window found').
    # Con el selector ya estable (35s), restaurar+enganchar es seguro (la sonda lo
    # probo sobre el selector estable del usuario).
    try:
        import win32gui as _wg3
        import win32con as _wc3
        _w3 = F._buscar_ventana_siape()
        _h3 = getattr(_w3, "_hWnd", None) if _w3 else None
        if _h3 and _wg3.IsIconic(_h3):
            _wg3.ShowWindow(_h3, _wc3.SW_RESTORE)
            time.sleep(2)
    except Exception:
        pass
    # (2) RESETEAR el driver JAB: el cacheado apunta al contexto de LOGIN (ya liberado
    # tras entrar). Sin reset, el proximo estado_siape camina ese contexto muerto y
    # crashea SIAPE. Con reset, el proximo _jab_driver crea uno FRESCO sobre el
    # selector ya restaurado y visible.
    try:
        F._jab_reset_driver()
    except Exception:
        pass
    # (2) Tiro el driver JAB cacheado (apunta al contexto de LOGIN ya liberado). El
    # proximo estado_siape crea uno FRESCO sobre la ventana nueva -> no crashea.
    try:
        F._jab_reset_driver()
    except Exception:
        pass
    # (3) RESTAURO la ventana si quedo minimizada: minimizada, TODO cae en bounds
    # -32000 y _bounds_ok descarta hasta el boton RRHH -> estado 'desconocido'.
    try:
        import win32gui as _wg
        import win32con as _wc
        _w = F._buscar_ventana_siape()
        _h = getattr(_w, "_hWnd", None) if _w else None
        if _h and _wg.IsIconic(_h):
            _wg.ShowWindow(_h, _wc.SW_RESTORE)
            time.sleep(1.0)
    except Exception:
        pass
    time.sleep(2)


def _entrar_erreh_robusto():
    """Entra al modulo eRreH por ACCION JAP (el.click), no por coordenadas
    (_jab_click_bounds necesitaba 5 intentos / apretarlo a mano)."""
    btn, _b = F._jab_buscar(nombre="RRHH", role="push button", timeout=20)
    if not btn:
        raise RuntimeError("No encuentro el modulo eRreH (boton RRHH) en el selector.")
    log("Entrando a eRreH (accion JAB)...")
    if not _click(btn):                 # simulate=False (accion) y si no, simulate=True
        raise RuntimeError("No pude entrar a eRreH.")
    time.sleep(PAUSA_LARGA)


def _cerrar_dialogo_accion(preferidos=("Continuar", "Aceptar", "OK", "Si", "Sí")):
    """Cierra el modal clickeando su boton por ACCION JAB (el.click), NO por
    coordenadas. El _jab_click_bounds de francos erraba el boton en esta maquina
    -> el cartel 'Se han Guardado los cambios' entraba en loop infinito."""
    raiz = None
    for el, _d, info in _jab_walk(max_depth=14, max_segundos=10):
        rol = info.get("role") or ""
        nom = (info.get("name") or "").strip().lower()
        if not F._bounds_ok(info):
            continue
        if rol in ("dialog", "alert") or (rol == "internal frame" and nom.startswith(F.DIALOGO_NOMBRES)):
            raiz = el
            break
    if raiz is None:
        return False
    botones = []
    for el, _d, info in _jab_walk(max_depth=8, root=raiz, max_segundos=10):
        if info.get("role") == "push button" and F._bounds_ok(info):
            botones.append((el, (info.get("name") or "").strip()))
    if not botones:
        pyautogui.press("enter"); time.sleep(PAUSA_CORTA); return True
    for quiero in preferidos:
        for el, nom in botones:
            if nom.lower().startswith(quiero.lower()):
                _click(el); time.sleep(PAUSA_CORTA); return True
    _click(botones[0][0]); time.sleep(PAUSA_CORTA); return True


# Sustituye login, entrada a eRreH y CIERRE DE MODALES de francos por versiones
# robustas por accion (asegurar_sesion/cerrar_modales los resuelven por nombre
# global -> toman estos).
F._hacer_login = _login_robusto
F._entrar_erreh = _entrar_erreh_robusto
F.cerrar_dialogo_jab = _cerrar_dialogo_accion

# RESTAURAR la ventana ANTES de cada chequeo de estado. El selector post-login abre
# MINIMIZADO -> el JAB no lo halla por titulo ('no java window found') y todo cae en
# bounds -32000. Restaurarlo (win32, ve las minimizadas) lo destraba. Ahora es SEGURO
# porque _login_robusto ya espero 35s: la transicion termino y la ventana esta estable
# (antes crasheaba por restaurar EN plena transicion).
_estado_siape_orig = F.estado_siape
_diag_win = {"hecho": False}

def _estado_siape_diag(*a, **k):
    try:
        import win32gui as _wg
        import win32con as _wc
        _w = F._buscar_ventana_siape()
        _h = getattr(_w, "_hWnd", None) if _w else None
        if _h:
            if _wg.IsIconic(_h):
                _wg.ShowWindow(_h, _wc.SW_RESTORE)
                time.sleep(0.6)
        elif not _diag_win["hecho"]:
            # No encuentro la ventana de SIAPE por titulo -> vuelco TODOS los titulos
            # y los procesos java, para saber como se llama realmente post-login.
            _diag_win["hecho"] = True
            try:
                import pygetwindow as _gw
                log("   [DIAG-WIN] SIAPE no encontrada por titulo. Ventanas abiertas:")
                for _t in _gw.getAllTitles():
                    if _t and _t.strip():
                        log(f"      [DIAG-WIN] '{_t}'")
            except Exception as _e:
                log(f"   [DIAG-WIN] fallo: {_e}")
    except Exception:
        pass
    return _estado_siape_orig(*a, **k)

F.estado_siape = _estado_siape_diag


def _find(frame, *, name=None, role=None, desc=None,
          x_min=None, x_max=None, y_min=None, y_max=None):
    """Primer elemento dentro de `frame` que matchea (scoped, rapido)."""
    return _jab_find_in(frame, name=name, role=role, desc=desc,
                        x_min=x_min, y_min=y_min, x_max=x_max, y_max=y_max)


def _find_starts(frame, prefijo, role=None, max_seg=15):
    """Elemento dentro de `frame` cuyo nombre EMPIEZA con `prefijo`."""
    pref = prefijo.upper()
    for el, _d, info in _jab_walk(max_depth=24, root=frame, max_segundos=max_seg):
        if role is not None and info.get("role") != role:
            continue
        if (info.get("name") or "").upper().startswith(pref):
            return el, info
    return None, None


def _find_frame(nombre, timeout=25):
    """Detecta un internal frame por PREFIJO de nombre (los nombres JAB traen
    espacios al final) y a POCA profundidad (los frames estan arriba -> rapido,
    no baja a la grilla)."""
    limite = time.time() + timeout
    while time.time() < limite:
        for el, _d, info in _jab_walk(max_depth=12, max_segundos=12):
            if info.get("role") != "internal frame":
                continue
            if not (info.get("name") or "").strip().startswith(nombre):
                continue
            b = info.get("bounds") or {}
            if (b.get("width") or 0) > 0:
                return el
        time.sleep(0.5)
    return None


def _fila1(frame, col_idx):
    """El '...' de la fila 1 de la columna `col_idx` (0=persona, 1=estructura,
    2=licencia). POR ESTRUCTURA, sin coordenadas hardcodeadas: junta todos los
    push button '...' de la grilla, los agrupa por su X real (las columnas, sea cual
    sea la posicion/tamano de la ventana) y devuelve el de arriba (min Y = fila 1) de
    la columna pedida. Reemplaza el mapeo fijo por X/Y que se rompia al moverse la
    ventana."""
    # POR ORDEN DE ARBOL, CERO coordenadas: en el recorrido los '...' aparecen
    # agrupados por columna (persona, luego estructura, luego licencia), y dentro de
    # cada grupo el PRIMERO es la fila 1. Detecto el inicio de cada grupo (un '...'
    # que sigue a algo que NO es '...') y tomo ese primero. col_idx elige la columna.
    primeros = []
    prev_puntos = False
    for _el, _d, info in F._jab_walk(root=frame, max_depth=20, max_segundos=30):
        es_puntos = (info.get("role") == "push button"
                     and (info.get("name") or "").strip() == "...")
        if es_puntos and not prev_puntos:
            primeros.append(_el)                       # 1er '...' de una columna
        prev_puntos = es_puntos
    if col_idx < len(primeros):
        return primeros[col_idx], None
    return None, None


# =================== DB ===================
def conn():
    return pymysql.connect(**DB, cursorclass=pymysql.cursors.DictCursor)


def traer(cn, solo_dni=None, limit=None):
    if solo_dni:
        sql = "SELECT dni,anio,dias,licencia,apellido FROM cola_carga_stress WHERE dni=%s"
        p = [solo_dni]
    else:
        sql = "SELECT dni,anio,dias,licencia,apellido FROM cola_carga_stress WHERE estado='pendiente'"
        p = []
    sql += " ORDER BY dias_transcurridos DESC"
    if limit:
        sql += " LIMIT %s"; p.append(limit)
    with cn.cursor() as c:
        c.execute(sql, p); return c.fetchall()


def marcar(cn, dni, anio, estado, motivo=None, dias=None, licencia=None):
    MN.registrar_item("siape_carga_stress", dni, None, licencia or "ANUAL COMPLEMENTARIA",
                      f"año {anio}", f"{dias} días" if dias is not None else None, estado, motivo)
    with cn.cursor() as c:
        c.execute("UPDATE cola_carga_stress SET estado=%s, motivo=%s WHERE dni=%s AND anio=%s",
                  (estado, motivo, dni, anio))
        if estado == "cargado":
            c.execute("INSERT INTO stress_cargados (dni,anio,dias,licencia) VALUES (%s,%s,%s,%s) "
                      "ON DUPLICATE KEY UPDATE dias=VALUES(dias), licencia=VALUES(licencia), cargado_at=CURRENT_TIMESTAMP",
                      (dni, anio, dias, licencia))
    cn.commit()


# =================== navegacion ===================
def _cerrar_ta():
    """Cierra Tiempo Acumulado descartando cualquier fila sin guardar, para que
    el proximo agente arranque con la grilla VACIA (TA abre vacio siempre) y la
    fila 1 quede libre. Sin esto, del 2do agente en adelante la fila 1 estaba
    ocupada por el anterior y se rompia todo."""
    if not _find_frame(FRAME_TA, timeout=2):
        cerrar_modales()
        return
    cxl, _c = F._jab_buscar(nombre="cancel", role="push button", timeout=6)
    if cxl:
        _click(cxl); time.sleep(PAUSA_CORTA)   # rollback: descarta la fila incompleta
    cerrar_modales()
    sal, _s = F._jab_buscar(nombre="Salir", role="push button", timeout=6)
    if sal:
        _click(sal); time.sleep(PAUSA_MEDIA)
    for _ in range(5):                          # ¿guardar? -> No; datos en blanco -> Continuar
        texto, _b = F.leer_dialogo_jab()
        if not texto:
            break
        F.cerrar_dialogo_jab(preferidos=("No", "Descartar", "Continuar", "Aceptar", "Si", "Sí"))
        time.sleep(PAUSA_CORTA)
    t0 = time.time()
    while time.time() - t0 < 10 and _find_frame(FRAME_TA, timeout=2):
        time.sleep(0.5)
    cerrar_modales()


def _recuperar():
    """Tras un fallo: cancela pickers abiertos (Buscador / Licencias) y hace
    rollback de la fila incompleta (boton 'cancel') SIN salir de TA, asi el
    proximo agente sigue con el + en la misma pantalla."""
    for _ in range(4):
        cerrar_modales()
        if _find_frame(FRAME_BUS, timeout=2):
            b, _b = F._jab_buscar(nombre="CANCELAR", role="push button", timeout=5)
            if b:
                _click(b); time.sleep(PAUSA_MEDIA); continue
        if _find_frame(FRAME_LIC, timeout=2):
            b, _b = F._jab_buscar(empieza="Cancelar", role="push button", timeout=5)
            if b:
                _click(b); time.sleep(PAUSA_MEDIA); continue
        break
    cxl, _c = F._jab_buscar(nombre="cancel", role="push button", timeout=6)
    if cxl:
        _click(cxl); time.sleep(PAUSA_CORTA)   # rollback de lo no guardado
    cerrar_modales()
    if not USAR_PLUS:
        _cerrar_ta()                            # modo clasico: cerrar TA para reabrir limpio
    # en modo --plus: dejar TA abierto; el proximo agente hace + (ya se hizo rollback)


def abrir_ta(timeout=40):
    # Cerrar+reabrir SIEMPRE: TA abre vacio -> cada agente arranca con grilla
    # limpia (sin residuos de dias/persona de una fila incompleta anterior). El
    # flujo "+" reusando pantalla heredaba esos residuos.
    _cerrar_ta()
    _activar_ventana(_buscar_ventana_siape())
    time.sleep(PAUSA_CORTA)
    # METODO A (probado): accion JAB pura sobre el item "Tiempo Acumulado",
    # SIN abrir el menu y SIN coordenadas -> el.click(simulate=False).
    it = None
    for el, _d, info in _jab_walk(max_depth=14, max_segundos=15):
        if info.get("role") == "menu item" and (info.get("name") or "").startswith("Tiempo Acumulado"):
            it = el
            break
    if not it:
        raise RuntimeError("No encuentro el item Tiempo Acumulado.")
    it.click(simulate=False)
    fr = _find_frame(FRAME_TA, timeout=timeout)
    if fr:
        log("Tiempo Acumulado abierto")
    return fr


# =================== pasos de carga ===================
_dump_ta = {"hecho": False}


def _dump_ta_grid(frame):
    """DIAG (una vez): vuelca el arbol de la grilla de Tiempo Acumulado con bounds,
    para ubicar el '...' de persona (rol/nombre/posicion reales)."""
    if _dump_ta["hecho"]:
        return
    _dump_ta["hecho"] = True
    log("   [DIAG-TA] arbol de Tiempo Acumulado (rol | name | desc | ok | bounds):")
    try:
        n = 0
        for el, d, info in F._jab_walk(root=frame, max_depth=20, max_segundos=40):
            n += 1
            rol = info.get("role") or ""
            nom = (info.get("name") or "").strip()
            desc = (info.get("description") or "").strip()
            b = info.get("bounds") or {}
            log(f"      [DIAG-TA] {rol} | '{nom}' | '{desc}' | ok={F._bounds_ok(info)} | {b}")
            if n >= 130:
                break
        log(f"   [DIAG-TA] total volcados = {n}")
    except Exception as e:
        log(f"   [DIAG-TA] fallo: {e}")


_dump_bus = {"hecho": False}


def _dump_buscador(bf):
    """DIAG (una vez): vuelca radios/text/botones del Buscador con nombre y bounds,
    para ubicar el campo DNI real."""
    if _dump_bus["hecho"]:
        return
    _dump_bus["hecho"] = True
    log("   [DIAG-BUS] arbol del Buscador (rol | name | ok | bounds):")
    try:
        n = 0
        for _el, _d, info in F._jab_walk(root=bf, max_depth=20, max_segundos=25):
            n += 1
            rol = info.get("role") or ""
            if rol not in ("radio button", "text", "push button", "combo box"):
                continue
            nom = (info.get("name") or "").strip()
            b = info.get("bounds") or {}
            log(f"      [DIAG-BUS] {rol} | '{nom}' | ok={F._bounds_ok(info)} | {b}")
            if n >= 90:
                break
        log(f"   [DIAG-BUS] total nodos recorridos = {n}")
    except Exception as e:
        log(f"   [DIAG-BUS] fallo: {e}")


def buscar_persona(frame, dni):
    log("   abro '...' de persona (fila 1)")
    _dump_ta_grid(frame)                      # DIAG: mapear la grilla una vez
    el, _i = _fila1(frame, 0)                # '...' persona (columna 0), fila 1
    if not el:
        raise RuntimeError("No encuentro el '...' de persona de la fila 1.")
    _click(el)                                # accion pura primero (metodo A)
    bf = _find_frame(FRAME_BUS, timeout=25)
    if not bf:
        raise RuntimeError("No abrio el Buscador de Personas.")
    _dump_buscador(bf)                        # DIAG: mapear el Buscador una vez
    log("   Buscador abierto -> radio Documento")
    # radio "Documento" POR NOMBRE, scopeado al Buscador, SIN banda de coords (el
    # diablo MDI se ubica en cualquier posicion -> la banda vieja no coincidia).
    rel = None
    _r = None
    for _el, _d, info in F._jab_walk(root=bf, max_depth=20, max_segundos=20):
        if info.get("role") != "radio button":
            continue
        if (info.get("name") or "").strip().startswith("Documento"):
            rel = _el
            _r = info
            break
    if not rel:
        raise RuntimeError("No encuentro el radio 'Documento' en el Buscador.")
    if not _click(rel):
        _click(rel, simulate=True)
    time.sleep(PAUSA_CORTA)
    log("   escribo DNI")
    # DNI POR ORDEN DE ARBOL (mapeado 15/09): el encabezado del Buscador es
    # [Apellido text][DNI-tipo text][boton '...'][DNI-NUMERO text][BUSCAR]. El numero
    # de documento es el PRIMER text DESPUES del boton '...' (y antes de BUSCAR). Antes
    # buscaba tras el radio 'Documento', pero el radio va DESPUES de los text en el
    # arbol -> no hallaba ninguno.
    dni_field = None
    visto_puntos = False
    for _el, _d, info in F._jab_walk(root=bf, max_depth=20, max_segundos=25):
        rol = info.get("role")
        nom = (info.get("name") or "").strip()
        if rol == "push button" and nom == "...":
            visto_puntos = True
            continue
        if rol == "push button" and nom == "BUSCAR":
            break
        if visto_puntos and rol == "text":
            dni_field = _el
            break
    if not dni_field:
        raise RuntimeError("No encuentro el campo de DNI en el Buscador.")
    _tipear(dni_field, dni)
    log("   BUSCAR")
    _rb = _find(bf, name="BUSCAR", role="push button")       # por nombre, scopeado
    bel = _rb[0] if _rb else None
    if not bel or not _click(bel):
        raise RuntimeError("No pude clickear BUSCAR.")
    time.sleep(PAUSA_LARGA)
    cerrar_modales()
    log("   selecciono primer resultado")
    # primer resultado = la PRIMERA celda 'APELLIDO Y NOMBRE' en orden de arbol (fila 1
    # de la grilla de resultados). Cero coordenadas.
    primera = None
    for _el, _d, info in F._jab_walk(root=bf, max_depth=20, max_segundos=20):
        if info.get("role") != "text":
            continue
        if (info.get("name") or "").strip().upper() != "APELLIDO Y NOMBRE":
            continue
        primera = _el
        break
    if primera:
        _click(primera, simulate=True)
        time.sleep(PAUSA_CORTA)
    _ra = _find(bf, name="ACEPTAR", role="push button")      # por nombre, scopeado
    ael = _ra[0] if _ra else None
    if not ael or not _click(ael):
        raise RuntimeError("No pude ACEPTAR en el Buscador.")
    time.sleep(PAUSA_LARGA)
    cerrar_modales()
    log("   persona seleccionada")


def _label_licencia_exacta(lf, licencia):
    obj = licencia.strip().upper()
    for el, _d, info in _jab_walk(max_depth=24, root=lf, max_segundos=45):
        if info.get("role") != "label":
            continue
        nom = (info.get("name") or "")
        if "Licencia / Permiso:" not in nom:
            continue
        cuerpo = nom.split("Licencia / Permiso:", 1)[1]
        cuerpo = cuerpo.split("\t")[0].split("Novedad:")[0].strip().upper()
        if cuerpo == obj:
            return el, info
    return None, None


def elegir_licencia(frame, licencia):
    log(f"   abro '...' de licencia -> {licencia}")
    el, _i = _fila1(frame, 2)                # '...' licencia (columna 2), fila 1
    if not _click(el):                        # accion pura primero (metodo A)
        raise RuntimeError("No pude abrir el picker de Licencia.")
    lf = _find_frame(FRAME_LIC, timeout=20)
    if not lf:
        raise RuntimeError("No abrio Licencias y Permisos.")
    cel, _c = _find(lf, name=" Buscar", role="text")
    if not cel:
        cel, _c = _find_starts(lf, "Buscar", role="text")
    if cel:
        _tipear(cel, licencia)
    bel, _b = _find(lf, name="Buscar ALT B", role="push button")
    if not bel:
        bel, _b = _find_starts(lf, "Buscar", role="push button")
    _click(bel)
    time.sleep(PAUSA_LARGA)                   # dar tiempo a que filtre la lista
    cerrar_modales()
    lab = None
    for _ in range(3):                        # reintento: el recorrido en RDP es lento
        lab, _l = _label_licencia_exacta(lf, licencia)
        if lab:
            break
        time.sleep(PAUSA_MEDIA)
    if not lab:
        raise RuntimeError(f"No encontre la licencia EXACTA '{licencia}' en la lista.")
    _click(lab, simulate=True)
    time.sleep(PAUSA_CORTA)
    ael, _a = _find(lf, name="Aceptar ALT A", role="push button")
    if not ael:
        ael, _a = _find_starts(lf, "Aceptar", role="push button")
    if not _click(ael):
        raise RuntimeError("No pude Aceptar en Licencias y Permisos.")
    time.sleep(PAUSA_MEDIA)
    cerrar_modales()
    log("   licencia elegida")


def _celda_anio(frame):
    # PRIMER text 'Año' en orden de arbol = fila 1 (cero coordenadas).
    return _find(frame, name="Año", role="text")


def _celda_dias(frame):
    # el nombre trae salto de linea ("C. Días\nx Ley"): busco por NOMBRE (contiene
    # 'Días'/'x Ley'), primer match en orden de arbol = fila 1. Cero coordenadas.
    for el, _d, info in F._jab_walk(root=frame, max_depth=20, max_segundos=25):
        if info.get("role") != "text":
            continue
        nom = info.get("name") or ""
        if ("Día" in nom) or ("Dia" in nom) or ("x Ley" in nom):
            return el, info
    return None, None


def _celda_lic(frame):
    # PRIMER text 'Licencia / Permiso' en orden de arbol = fila 1 (cero coordenadas).
    return _find(frame, name="Licencia / Permiso", role="text")


def _limpiar_campo():
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    pyautogui.press("backspace", presses=15, interval=0.01)
    time.sleep(0.1)


def set_anio_dias(frame, anio, dias, intentos=4):
    """Escribe Año y salta a C.Días con TAB (el foco directo a C.Días no anda ->
    el valor caia en Año), con SIAPE al frente para que el teclado aterrice.
    ROBUSTO: reintenta releyendo AMBAS celdas (las dos son legibles por JAB); el
    salto por WM-TAB a veces no aterriza (SIAPE no quedaba al frente / el TAB no
    avanzaba) y los valores caian vacios o pisados juntos en Año. Si tras los
    reintentos no verifica, deja el estado como esta y verificar() del caller lo
    reporta y NO guarda. Uso _frente_liviano (NO el foreground min/restore, que
    rompe el arbol JAB a mitad de carga)."""
    # Año/C.Días estan en la ventana PRINCIPAL (no en un modal): hay que traerla
    # al frente para que el WM aterrice (los modales Buscador/Licencias se
    # enfocaban solos, por eso DNI/licencia andan sin esto).
    anio_s, dias_s = str(anio), str(dias)
    ultimo = ""
    for i in range(intentos):
        _frente_liviano()
        _wm_key(0x1B, 0x01)          # Escape por WM: cierra cualquier menu que haya
        time.sleep(0.2)              # quedado abierto (roba el foco del teclado)
        ael, _a = _celda_anio(frame)
        if not ael:
            raise RuntimeError("No encuentro la celda Año.")
        # FOCO por CLIC en la celda (request_focus en celdas Forms no enfoca -> el
        # tipeo caia en el frame/menu y no aterrizaba). El clic simulate usa los bounds
        # vivos de la celda.
        if not _click(ael, simulate=True):
            try:
                ael.request_focus()
            except Exception:
                pass
        time.sleep(PAUSA_CORTA)
        _wm_type(anio_s)             # WM_CHAR (autolimpia el campo con BACKSPACE/DELETE)
        _wm_tab()                    # TAB por WM con lParam bien armado (sin foco del SO)
        _wm_type(dias_s)
        time.sleep(PAUSA_CORTA)
        va = (F._jab_read_text(_celda_anio(frame)[0]) or "").strip()
        vd = (F._jab_read_text(_celda_dias(frame)[0]) or "").strip()
        if va == anio_s and vd == dias_s:
            log(f"   Año={anio_s} / C.Días={dias_s}" + (f" (OK al intento {i+1})" if i else ""))
            return
        ultimo = f"Año='{va}' C.Días='{vd}'"
        log(f"   reintento Año/C.Días ({i+1}/{intentos}): lei {ultimo} (esp {anio_s}/{dias_s})")
    log(f"   Año/C.Días NO verificado tras {intentos} intentos: {ultimo}")


def verificar(frame, anio, dias, licencia):
    probl = []
    va = _jab_read_text(_celda_anio(frame)[0]).strip()
    if va != str(anio):
        probl.append(f"Año='{va}' (esp {anio})")
    vd = _jab_read_text(_celda_dias(frame)[0]).strip()
    if vd != str(dias):
        probl.append(f"C.Dias='{vd}' (esp {dias})")
    vl = _jab_read_text(_celda_lic(frame)[0]).strip()
    if vl.upper() != licencia.strip().upper():
        probl.append(f"Licencia='{vl}' (esp {licencia})")
    return (len(probl) == 0, "; ".join(probl))


def _guardar():
    g, _ = F._jab_buscar(nombre="Guardar", role="push button", timeout=15)
    if not _click(g):
        raise RuntimeError("No pude clickear Guardar.")
    time.sleep(PAUSA_LARGA)
    for _ in range(6):
        texto, _b = F.leer_dialogo_jab()
        if not texto:
            return True, "GUARDADO"
        t = " ".join(texto.split()).lower()
        if "se han guardado" in t or "exito" in t:
            F.cerrar_dialogo_jab(); return True, "GUARDADO"
        if "guardar los cambios" in t or "desea guardar" in t or "confirma" in t:
            F.cerrar_dialogo_jab(preferidos=("Si", "Sí", "Aceptar", "Continuar")); time.sleep(PAUSA_MEDIA); continue
        if "ya existe" in t or "ya hay ingresado" in t:
            F.cerrar_modales(); return False, "ya existia"
        F.cerrar_modales(); return False, "SiAPe: " + " ".join(texto.split())[:150]
    return True, "GUARDADO"


def _frente_liviano(w=None):
    """Trae SIAPE al frente SIN minimizar/restaurar (eso rompe el arbol JAB a
    mitad de carga). Solo SetForegroundWindow via AttachThreadInput."""
    import ctypes
    import win32gui
    if w is None:
        w = _buscar_ventana_siape()
    if w is None:
        return False
    hwnd = getattr(w, "_hWnd", None)
    if not hwnd:
        return False
    u = ctypes.windll.user32
    k = ctypes.windll.kernel32
    try:
        u.SystemParametersInfoW(0x2001, 0, 0, 0)
        fg = u.GetForegroundWindow()
        if fg == hwnd:
            return True
        tid_fg = u.GetWindowThreadProcessId(fg, None)
        tid_me = k.GetCurrentThreadId()
        eng = u.AttachThreadInput(tid_me, tid_fg, True)
        try:
            u.BringWindowToTop(hwnd)
            u.SetForegroundWindow(hwnd)
        finally:
            if eng:
                u.AttachThreadInput(tid_me, tid_fg, False)
    except Exception:
        pass
    return u.GetForegroundWindow() == hwnd


def _traer_al_frente():
    """Al inicio de cada agente: maximizar + foreground LIVIANO (sin min/restore
    que rompe el JAB). El foreground pesado (min+restore) queda solo en el login."""
    w = _buscar_ventana_siape()
    if w is None:
        return
    try:
        w.maximize()
    except Exception:
        pass
    _frente_liviano(w)
    time.sleep(PAUSA_CORTA)


def cargar_uno(dni, anio, dias, licencia, primero=True):
    _traer_al_frente()
    if USAR_PLUS and not primero and _find_frame(FRAME_TA, timeout=6):
        # Reusar la pantalla: nuevo registro con el + verde (Agregar), en vez de
        # salir/reabrir. La grilla se limpio una vez al inicio (primer agente).
        frame = _find_frame(FRAME_TA, timeout=6)
        ag, _ = F._jab_buscar(nombre="Agregar", role="push button", timeout=15)
        if not _click(ag):
            raise RuntimeError("No pude clickear Agregar (+).")
        time.sleep(PAUSA_MEDIA)
        cerrar_modales()
        frame = _find_frame(FRAME_TA, timeout=10) or frame
    else:
        frame = abrir_ta()           # cierra+reabre: grilla vacia, fila 1 lista
    if not frame:
        raise RuntimeError("No pude abrir Tiempo Acumulado.")
    cerrar_modales()
    buscar_persona(frame, dni)
    frame = _find_frame(FRAME_TA, timeout=10) or frame
    elegir_licencia(frame, licencia)
    frame = _find_frame(FRAME_TA, timeout=10) or frame
    set_anio_dias(frame, anio, dias)
    ok, motivo = verificar(frame, anio, dias, licencia)
    if not ok:
        log(f"   VERIFICACION FALLIDA: {motivo} -> NO guardo")
        return False, motivo
    log(f"   verificado OK (Año {anio}, C.Días {dias}, {licencia})")
    return _guardar()


# =================== main ===================
def _pre_login_sin_jab():
    """Abre SIAPE y loguea SIN tocar el JAB (Usuario/Contraseña por WM_CHAR + Enter).
    Asi el bridge JAB NO queda enganchado al Java del login; el primer JABDriver se
    crea despues, sobre la ventana de la APP."""
    import win32api as _wa
    import win32con as _wc2
    log("Pre-login SIN JAB (abrir + WM_CHAR + Enter)...")
    F.abrir_siape_si_falta()
    for _ in range(60):                       # esperar la ventana de login (por titulo)
        if F._buscar_ventana_siape():
            break
        time.sleep(1)
    time.sleep(8)                             # que renderice el login
    hwnd = _hwnd_siape()
    if not hwnd:
        log("   pre-login: no encuentro la ventana; dejo que asegurar_sesion resuelva.")
        return
    _forzar_frente_seguro()                   # maximizar/frente (win32, sin JAB)
    time.sleep(PAUSA_CORTA)
    _wm_type(F.SIAPE_USER, hwnd)              # Usuario (campo enfocado por defecto)
    _wm_tab(hwnd)                             # -> Contraseña
    time.sleep(1.0)
    for _ in range(15):                       # limpiar Contraseña
        _wa.PostMessage(hwnd, _wc2.WM_KEYDOWN, _wc2.VK_BACK, 0)
        _wa.PostMessage(hwnd, _wc2.WM_KEYUP, _wc2.VK_BACK, 0)
    time.sleep(0.3)
    for _ch in str(F.SIAPE_PASS):             # Contraseña por WM_CHAR
        _wa.PostMessage(hwnd, _wc2.WM_CHAR, ord(_ch), 0)
        time.sleep(0.15)
    time.sleep(PAUSA_CORTA)
    _wa.PostMessage(hwnd, _wc2.WM_KEYDOWN, _wc2.VK_RETURN, 0)   # INGRESAR = Enter
    _wa.PostMessage(hwnd, _wc2.WM_KEYUP, _wc2.VK_RETURN, 0)
    log("   pre-login enviado (Usuario+Contraseña+Enter, sin JAB). Espero la app 35s...")
    time.sleep(35)                            # que cargue la app, SIN tocar JAB
    _LOGIN_STATE["intentado"] = True          # si igual cae en login, que no re-loopee


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dni", type=int)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--solo-abrir", action="store_true")
    ap.add_argument("--solo-login", action="store_true",
                    help="ETAPA 1: abre SIAPE, loguea y SALE limpio (deja el selector)")
    ap.add_argument("--plus", action="store_true", help="reusar pantalla con el + verde (mas rapido)")
    args = ap.parse_args()
    global USAR_PLUS
    USAR_PLUS = args.plus

    cn = conn()
    pend = traer(cn, solo_dni=args.dni, limit=args.limit)
    log(f"{len(pend)} en cola")
    for r in pend:
        log(f"  {r['dni']}  {r['apellido']:<30} anio={r['anio']} dias={r['dias']} lic={r['licencia']}")
    if args.dry_run:
        log("--dry-run"); return
    if pyautogui is None:
        raise RuntimeError("Falta pyautogui")
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE

    if args.solo_login:
        # ETAPA 1 (diseno de robots separados): abrir SIAPE, loguear y SALIR LIMPIO,
        # SIN volver a caminar el JAB post-login (eso es lo que crashea en la
        # transicion). Deja SIAPE en el selector para que la ETAPA 2 (proceso nuevo)
        # se enganche a una ventana YA estable.
        if not F._buscar_ventana_siape():
            F.abrir_siape_si_falta()
        F._activar_ventana(F._buscar_ventana_siape())
        for _ in range(40):                       # esperar la pantalla de login
            try:
                if F.estado_siape() == F.ESTADO_LOGIN:
                    break
            except Exception:
                pass
            time.sleep(1)
        F._hacer_login()                          # _login_robusto (1 intento)
        log("--solo-login: login hecho; salgo limpio (SIAPE queda en el selector).")
        return

    # PRE-LOGIN SIN JAB: si SIAPE no esta abierto, abrirlo y loguear por WM_CHAR+Enter
    # SIN inicializar el puente JAB. CLAVE: el bug era que el robot enganchaba el JAB
    # sobre la ventana de LOGIN; tras entrar, SIAPE abre la app (otro Java) y el bridge
    # quedaba pegado al login -> 'no java window'. Logueando sin JAB, el PRIMER
    # JABDriver lo crea asegurar_sesion DESPUES, sobre la app (como cuando el usuario
    # abre SIAPE a mano y el robot engancha directo la app).
    if not F._buscar_ventana_siape():
        _pre_login_sin_jab()

    asegurar_sesion(); cerrar_modales(); ventana_siape()
    pyautogui.PAUSE = PAUSA_CORTA

    ok = err = 0
    primero = True
    log(f"modo: {'+ verde (--plus)' if USAR_PLUS else 'cerrar/reabrir'}")
    for r in pend:
        log(f"-- {r['dni']} {r['apellido']} -----")
        try:
            if args.solo_abrir:
                frame = abrir_ta()
                cerrar_modales()
                buscar_persona(frame, r["dni"])
                log("--solo-abrir: persona seleccionada, corto."); break
            okc, mot = cargar_uno(r["dni"], r["anio"], r["dias"], r["licencia"], primero=primero)
            primero = False
            if okc and mot == "GUARDADO":
                marcar(cn, r["dni"], r["anio"], "cargado", "cargado JAB (verificado)",
                       dias=r["dias"], licencia=r["licencia"]); ok += 1; log("   OK guardado")
            elif mot == "ya existia":
                # SiAPe ya lo tiene -> es un exito para el pipeline, no reintentar
                marcar(cn, r["dni"], r["anio"], "cargado", "ya estaba en SiAPe",
                       dias=r["dias"], licencia=r["licencia"]); ok += 1; log("   ya estaba en SiAPe (OK)")
            else:
                marcar(cn, r["dni"], r["anio"], "error", mot); err += 1; log(f"   ERROR: {mot}")
                _recuperar()                 # saltea este y limpia para el siguiente
        except Exception as e:
            marcar(cn, r["dni"], r["anio"], "error", str(e)[:200]); err += 1
            log(f"   EXCEPCION: {e}")
            primero = True                   # tras un fallo, el proximo abre TA de cero
            if "No encuentro la ventana" in str(e) or "no abrio" in str(e).lower():
                # SIAPE se cayo/expiro a mitad -> re-abrir y re-loguear y seguir
                log("   SIAPE perdido: re-abro y re-logueo...")
                try:
                    asegurar_sesion(); cerrar_modales(); ventana_siape()
                    log("   sesion re-establecida, sigo con el siguiente")
                except Exception as e3:
                    log(f"   (no pude re-establecer SIAPE: {e3})")
            else:
                try:
                    _recuperar()             # cancela pickers abiertos + cierra TA
                except Exception as e2:
                    log(f"   (recuperacion fallo: {e2})"); cerrar_modales()
    cn.close()
    log(f"Listo. ok={ok} err={err}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Cancelado."); sys.exit(130)
    except Exception as e:
        import traceback
        log(f"ERROR: {e}")
        for l in traceback.format_exc().splitlines():
            log(f"    {l}")
        sys.exit(1)
