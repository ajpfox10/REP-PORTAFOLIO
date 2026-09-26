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
from cargar_stress_jab import _forzar_frente_seguro

pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE  # mismo criterio que cargar_stress_jab.py / corregir_stress_jab.py

DESCARGAS_DIR = Path.home() / "Downloads"
COMPARACION = Path(r"D:\G\comparacion")

# periodo: como se completa el modal si aparece.
#   "mes_a_fin" -> PERIODO dia 1 del mes .. fin de anio (ver calcular_periodo)
#   "anio"      -> PERIODO 01/01 .. 31/12 del anio en curso
#   "hoy"       -> FECHA = hoy
#   None        -> la consulta no pide fechas (si igual aparece un modal, se usa hoy / mes_a_fin)
# Los nombres de destino que ya existian en comparacion se respetan (los leen
# otras paginas): HORARIOS.xlsx = consulta 76, "plantel nominado.xlsx" = 1.
CONSULTAS = {
    "Examenes Médicos Salud": {
        "script_id": "siape_examenes_medicos",
        "descripcion": "Exportación Exámenes Médicos Salud (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "EXAMENES_MEDICOS.xlsx",
        "periodo": "anio",
    },
    "Horario Administrativo a un dia": {
        "script_id": "siape_horario_admin_dia",
        "descripcion": "Exportación Horario Administrativo a un día (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIOS.xlsx",
        "periodo": "hoy",
    },
    "Horario Administrativo Consolidado de los Agentes": {
        "script_id": "siape_horario_admin_consolidado",
        "descripcion": "Exportación Horario Administrativo Consolidado (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIO_CONSOLIDADO.xlsx",
        "periodo": None,
    },
    "Horario Guardia Salud a un dia": {
        "script_id": "siape_horario_guardia_dia",
        "descripcion": "Exportación Horario Guardia Salud a un día (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "HORARIO_GUARDIA.xlsx",
        "periodo": "hoy",
    },
    "Licencias Médicas": {
        "script_id": "siape_licencias_medicas",
        "descripcion": "Exportación Licencias Médicas (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "LICENCIAS_MEDICAS.xlsx",
        "periodo": "mes_a_fin",
    },
    "Novedades Pendientes de Autorización": {
        "script_id": "siape_novedades_pendientes",
        "descripcion": "Exportación Novedades Pendientes de Autorización (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "NOVEDADES_PENDIENTES.xlsx",
        "periodo": None,
    },
    "Novedades Por Periodo": {
        "script_id": "siape_novedades_por_periodo",
        "descripcion": "Exportación Novedades Por Periodo (SIAPE)",
        "destino_dir": COMPARACION / "SIAPE",
        "destino_nombre": "SIAPE.xlsx",
        "periodo": "mes_a_fin",
    },
    "Novedades Rechazadas": {
        "script_id": "siape_novedades_rechazadas",
        "descripcion": "Exportación Novedades Rechazadas (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "NOVEDADES_RECHAZADAS.xlsx",
        "periodo": "hoy",
    },
    "Plantel Nominado": {
        "script_id": "siape_plantel_nominado",
        "descripcion": "Exportación Plantel Nominado (SIAPE)",
        "destino_dir": COMPARACION,
        "destino_nombre": "plantel nominado.xlsx",
        "periodo": None,
    },
}


def _norm(t):
    """Compara nombres sin acentos/mayusculas/espacios dobles (JAB a veces
    devuelve los acentos raros)."""
    t = unicodedata.normalize("NFKD", t or "")
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.lower().split())


def calcular_periodo(hoy=None):
    """Desde = dia 1 del mes actual. Hasta = 31/12 del anio en curso, salvo
    octubre/noviembre/diciembre, donde se extiende a febrero/marzo/abril del
    anio siguiente (para no quedar con una ventana muy corta a fin de anio)."""
    hoy = hoy or date.today()
    desde = date(hoy.year, hoy.month, 1)
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


def abrir_gestor_exportaciones(timeout=20):
    frame, info = F._jab_find_frame("Gestor de Exportaciones", timeout=15, max_segundos=15)
    if frame:
        F.log("Gestor de Exportaciones ya estaba abierto, lo reuso.")
        return frame, info

    F.log("Navego por teclado: Exportaciones -> Consultas a Exportar...")
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


def fila_consulta(nombre_consulta, timeout=20):
    """Busca la fila por nombre y devuelve (info, texto_real) - `texto_real`
    es el valor tal cual lo devuelve JAB (con posibles espacios/acentos raros)
    para usarlo como `nombre_esperado` del click verificado."""
    objetivo = _norm(nombre_consulta)
    limite = time.time() + timeout
    while time.time() < limite:
        for el, _depth, info in F._jab_walk(max_depth=24, max_segundos=10):
            if info.get("role") != "text":
                continue
            if (info.get("name") or "") != "NOMBRE DE LA CONSULTA":
                continue
            b = info.get("bounds") or {}
            if (b.get("y") or -1) < 250:
                continue
            texto = (F._jab_read_text(el) or "").strip()
            if _norm(texto) == objetivo:
                return info, texto
        time.sleep(1)
    return None, None


def boton_exportar_en(y, tol=6, timeout=10):
    _, info = F._jab_buscar(nombre="Exportar", role="push button", timeout=timeout,
                             y_min=y - tol, y_max=y + tol)
    return info.get("bounds") if info else None


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


def descargar_una(nombre, args, ya_bajados):
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

        info_fila, texto_fila = fila_consulta(nombre)
        if not info_fila:
            raise RuntimeError(f"No encontre la consulta '{nombre}' en la grilla.")

        # Click VERIFICADO: confirma por JAB que el foco cayo en esta fila y
        # si no, se autocalibra (ver `_jab_click_bounds_verificado` en
        # cargar_francos_siape.py) - esto deja la escala/offset correctos
        # para el resto de los clicks de esta corrida (Exportar, fechas, etc).
        if not F._jab_click_bounds_verificado(info_fila, texto_fila, role="text"):
            raise RuntimeError(
                f"No pude confirmar el click sobre la fila '{nombre}' ni autocalibrando."
            )

        b_fila = info_fila.get("bounds") or {}
        b_exportar = boton_exportar_en(b_fila["y"])
        if not b_exportar:
            raise RuntimeError("No encontre el boton Exportar de la fila.")

        t_click = time.time()
        F._jab_click_bounds({"bounds": b_exportar})
        time.sleep(1.2)

        modal = esperar_modal(timeout=10)
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
        registrar_resultado(cfg["script_id"], cfg["descripcion"], "error", motivo=str(e), duracion_seg=duracion)
        # deja la pantalla limpia para la siguiente consulta (modal a medio llenar)
        try:
            _, cancelar = F._jab_buscar(nombre="CANCELAR Alt A", role="push button", timeout=3)
            if cancelar:
                F._jab_click_bounds(cancelar)
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

    try:
        F.asegurar_sesion()
    except Exception as e:
        F.log(f"ERROR: no pude asegurar la sesion de SIAPE: {e}")
        for n in nombres:
            cfg = CONSULTAS[n]
            registrar_resultado(cfg["script_id"], cfg["descripcion"], "error", motivo=f"sesion: {e}")
        return 1

    ya_bajados = []
    fallas = [n for n in nombres if not descargar_una(n, args, ya_bajados)]
    F.log(f"Fin: {len(nombres) - len(fallas)}/{len(nombres)} OK"
          + (f" - fallaron: {fallas}" if fallas else ""))
    return 1 if fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
