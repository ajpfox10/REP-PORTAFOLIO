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
Y_FILA1 = 244          # primera fila de la grilla (del volcado)
Y_TOL = 12
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
    # UN solo ciclo minimizar+restaurar (fuerza el frente al restaurar). NADA de
    # ALT (abre el menu del sistema). Ojo: nunca dejar la ventana minimizada.
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
        time.sleep(0.15)
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        time.sleep(0.25)
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


def _login_robusto():
    """Login SIN coordenadas: request_focus por campo + teclado. Reemplaza al
    _hacer_login de francos, que llenaba por _jab_click_bounds y metia usuario y
    contraseña juntos en el campo Usuario."""
    if not F.SIAPE_USER or not F.SIAPE_PASS:
        raise RuntimeError("Falta SIAPE_USER o SIAPE_PASS en .env.")
    usr, _u = F._jab_buscar(nombre="Usuario", role="text", timeout=20)
    btn, _b = F._jab_buscar(nombre="INGRESAR", role="push button", timeout=20)
    if not (usr and btn):
        raise RuntimeError("Pantalla de login pero no encuentro Usuario/INGRESAR.")
    log(f"Logueando como {F.SIAPE_USER}...")
    cerrar_modales()
    # Login por WM_CHAR (sin depender del foco del SO): request_focus(Usuario) +
    # WM type, TAB por WM a Contraseña, WM type, INGRESAR por accion JAB.
    hwnd = _hwnd_siape()
    try:
        usr.request_focus()
    except Exception:
        pass
    time.sleep(PAUSA_CORTA)
    _wm_type(F.SIAPE_USER, hwnd)
    _wm_tab(hwnd)                                 # Usuario -> Contraseña
    _wm_type(F.SIAPE_PASS, hwnd)
    time.sleep(PAUSA_CORTA)
    if not _click(btn):                          # INGRESAR por accion JAB
        pyautogui.press("enter")
    time.sleep(PAUSA_LARGA)


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


def _fila1(frame, x_min, x_max):
    """El '...' de la PRIMERA fila. Usa banda_y (poda del walk) = camino rapido
    de francos, no el walk completo de la grilla."""
    return F._jab_buscar(nombre="...", role="push button",
                         banda_y=(Y_FILA1 - Y_TOL, Y_FILA1 + Y_TOL),
                         x_min=x_min, x_max=x_max,
                         y_min=Y_FILA1 - Y_TOL, y_max=Y_FILA1 + Y_TOL, timeout=40)


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
def buscar_persona(frame, dni):
    log("   abro '...' de persona (fila 1)")
    el, _i = _fila1(frame, 95, 130)          # '...' persona, primera fila
    if not el:
        raise RuntimeError("No encuentro el '...' de persona de la fila 1.")
    _click(el)                                # accion pura primero (metodo A)
    bf = _find_frame(FRAME_BUS, timeout=25)
    if not bf:
        raise RuntimeError("No abrio el Buscador de Personas.")
    log("   Buscador abierto -> radio Documento")
    rel, _r = F._jab_buscar(empieza="Documento", role="radio button",
                            banda_y=(280, 300), timeout=25)
    _click(rel)
    time.sleep(PAUSA_CORTA)
    log("   escribo DNI")
    cel, _c = F._jab_buscar(role="text", x_min=545, x_max=560,
                            banda_y=(283, 297), y_min=283, y_max=297, timeout=25)
    if not cel:
        raise RuntimeError("No encuentro el campo de DNI en el Buscador.")
    _tipear(cel, dni)
    log("   BUSCAR")
    bel, _b = F._jab_buscar(nombre="BUSCAR", role="push button",
                            banda_y=(265, 290), timeout=25)
    if not _click(bel):
        raise RuntimeError("No pude clickear BUSCAR.")
    time.sleep(PAUSA_LARGA)
    cerrar_modales()
    log("   selecciono primer resultado")
    fel, _f = F._jab_buscar(nombre="APELLIDO Y NOMBRE", role="text",
                            banda_y=(363, 380), y_min=363, y_max=380, timeout=20)
    if fel:
        _click(fel, simulate=True)
        time.sleep(PAUSA_CORTA)
    ael, _a = F._jab_buscar(nombre="ACEPTAR", role="push button",
                            banda_y=(640, 665), timeout=20)
    if not _click(ael):
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
    el, _i = _fila1(frame, 740, 760)         # '...' licencia, primera fila
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
    return _find(frame, name="Año", role="text",
                 y_min=Y_FILA1 - Y_TOL, y_max=Y_FILA1 + Y_TOL)


def _celda_dias(frame):
    # el nombre trae salto de linea ("C. Días\nx Ley"); busco por posicion x=824
    return _find(frame, role="text", x_min=820, x_max=880,
                 y_min=Y_FILA1 - Y_TOL, y_max=Y_FILA1 + Y_TOL)


def _celda_lic(frame):
    return _find(frame, name="Licencia / Permiso", role="text",
                 y_min=Y_FILA1 - Y_TOL, y_max=Y_FILA1 + Y_TOL)


def _limpiar_campo():
    pyautogui.hotkey("ctrl", "a")
    pyautogui.press("delete")
    pyautogui.press("backspace", presses=15, interval=0.01)
    time.sleep(0.1)


def set_anio_dias(frame, anio, dias):
    """Enfoca Año con request_focus y salta a C.Días con TAB (el foco a C.Días
    directo no anda -> el valor caia en Año). Con SIAPE al frente forzado, el
    teclado aterriza. Este es el metodo que funciono en el test de 2."""
    # Año/C.Días estan en la ventana PRINCIPAL (no en un modal): hay que traerla
    # al frente para que el WM aterrice (los modales Buscador/Licencias se
    # enfocaban solos, por eso DNI/licencia andan sin esto).
    _frente_liviano()
    ael, _a = _celda_anio(frame)
    if not ael:
        raise RuntimeError("No encuentro la celda Año.")
    log(f"   Año={anio}")
    try:
        ael.request_focus()          # el cursor de Forms suele caer en Año tras la licencia
    except Exception:
        pass
    time.sleep(PAUSA_CORTA)
    _wm_type(anio)                   # WM_CHAR
    log(f"   C.Días={dias} (WM-TAB Año->C.Días)")
    _wm_tab()                        # TAB por WM con lParam bien armado (sin foco del SO)
    _wm_type(dias)
    time.sleep(PAUSA_CORTA)


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
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dni", type=int)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--solo-abrir", action="store_true")
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
