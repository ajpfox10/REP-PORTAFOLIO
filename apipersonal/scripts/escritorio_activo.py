"""
Escritorio activo para los robots que usan mouse/teclado reales (SiAPe).

Si se cierra el Escritorio Remoto sin mas, la sesion queda DESCONECTADA: Windows
deja de dibujar (las capturas salen negras) y el tipeo/clicks fisicos se pierden
(el modal de fecha queda sin ACEPTAR y nunca se pide la descarga, 10-11/10/2026).
Lo mismo que siape_stress/mantener_sesion_activa.bat, pero automatico: si la
sesion de este proceso esta desconectada, se pasa a la consola con tscon.
"""
import ctypes
import os
import subprocess
import time
from ctypes import wintypes

WTS_CONNECT_STATE = 8          # WTSConnectState (WTS_INFO_CLASS)
ESTADOS = {0: "Activo", 1: "Conectado", 2: "ConnectQuery", 3: "Shadow", 4: "Desconectado",
           5: "Idle", 6: "Listen", 7: "Reset", 8: "Down", 9: "Init"}
WTS_DESCONECTADO = 4


def _sesion_actual():
    sid = wintypes.DWORD()
    ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(sid))
    return sid.value


def _estado_sesion(sid):
    wtsapi = ctypes.windll.wtsapi32
    buf = ctypes.c_void_p()
    n = wintypes.DWORD()
    if not wtsapi.WTSQuerySessionInformationW(None, sid, WTS_CONNECT_STATE, ctypes.byref(buf), ctypes.byref(n)):
        return None
    try:
        return ctypes.cast(buf, ctypes.POINTER(ctypes.c_int)).contents.value
    finally:
        wtsapi.WTSFreeMemory(buf)


def asegurar_escritorio_activo(log=print):
    """Si la sesion esta desconectada, la pasa a la consola. True si quedo usable."""
    try:
        sid = _sesion_actual()
        if sid == 0:
            log("AVISO: el robot corre en la sesion 0 (sin escritorio): mouse/teclado no van a andar.")
            return False
        estado = _estado_sesion(sid)
        if estado != WTS_DESCONECTADO:
            return True
        log(f"Sesion {sid} {ESTADOS.get(estado, estado)}: la paso a la consola (tscon) para que haya escritorio.")
        tscon = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "tscon.exe")
        r = subprocess.run([tscon, str(sid), "/dest:console"], capture_output=True, text=True, timeout=30)
        time.sleep(5)  # que Windows vuelva a dibujar
        nuevo = _estado_sesion(sid)
        if r.returncode != 0 or nuevo == WTS_DESCONECTADO:
            log(f"AVISO: tscon no la activo (codigo {r.returncode}, estado {ESTADOS.get(nuevo, nuevo)}): "
                f"{(r.stdout or '').strip()} {(r.stderr or '').strip()}")
            return False
        log(f"Sesion {sid} ahora: {ESTADOS.get(nuevo, nuevo)}.")
        return True
    except Exception as e:
        log(f"AVISO: no pude verificar/activar el escritorio: {e}")
        return False


def pantalla_sesion():
    """(ancho, alto, escala_%) del monitor principal de ESTA sesion. La escala la
    impone la PC que se conecta por RDP (100% o 150% segun la PC, 18/10/2026) y con
    algo distinto de 100% los clicks de los robots de SiAPe caen corridos. Se mide
    por monitor (per-monitor DPI aware) para leer el valor actual y no el del logon."""
    user32 = ctypes.windll.user32
    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass
    dpi = None
    try:
        mon = user32.MonitorFromPoint(wintypes.POINT(0, 0), 1)  # MONITOR_DEFAULTTOPRIMARY
        dx, dy = wintypes.UINT(), wintypes.UINT()
        if ctypes.windll.shcore.GetDpiForMonitor(mon, 0, ctypes.byref(dx), ctypes.byref(dy)) == 0:
            dpi = dx.value
    except Exception:
        dpi = None
    if not dpi:
        hdc = user32.GetDC(None)
        try:
            dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        finally:
            user32.ReleaseDC(None, hdc)
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1), round(dpi * 100 / 96)


def chequear_escala(log=print):
    """None si la sesion esta al 100%; si no, el motivo para cortar el robot."""
    try:
        ancho, alto, escala = pantalla_sesion()
    except Exception as e:
        log(f"AVISO: no pude medir la pantalla de la sesion: {e}")
        return None
    log(f"Pantalla de la sesion: {ancho}x{alto} al {escala}%.")
    if escala == 100:
        return None
    return (f"La sesion del servidor esta al {escala}% ({ancho}x{alto}), no al 100%: la impone la PC "
            f"conectada por Escritorio Remoto y con eso los clicks en SiAPe caen corridos. "
            f"Reconectar desde una PC al 100% (o fijar IgnoreClientDesktopScaleFactor en el servidor) y relanzar.")


if __name__ == "__main__":
    sid = _sesion_actual()
    print(f"Sesion {sid}: {ESTADOS.get(_estado_sesion(sid))}")
    print(chequear_escala() or "Escala OK (100%).")
