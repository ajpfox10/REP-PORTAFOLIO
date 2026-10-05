"""
Carga en SIAPE el EXAMEN que falta despues de un PRE-EXAMEN.

Regla (art. 59 Dec. 4161/96, reglamentario ley 10430): el pre-examen son los
dias "inmediatos anteriores a la fecha fijada para el examen"; el examen es el
DIA SIGUIENTE al ultimo dia de pre-examen, caiga donde caiga (sabado, domingo o
feriado). Misma regla que examenesAutomaticos() del comparador SIAPE (que lo
carga en el Ministerio).

Flujo por agente (pantalla Novedades de Ausentismo -> pestana LICENCIAS,
mapeada en vivo el 26/09/2026):
  1. Ficheros -> busca por apellido y nombre -> abre al agente (verifica que el
     nombre del encabezado sea el buscado; si no, FRENA).
  2. Pestana LICENCIAS: lee la grilla. Si ya hay EXAMEN en esa fecha -> ya_estaba
     (no duplica).
  3. "Agregar" (+) por accion JAB PURA (el click simulado cae en otro icono por
     la escala de pantalla) -> registro nuevo en blanco.
  4. Licencia-Permiso = EXAMEN, JUSTIFICADO SIN TILDAR, Ano, Desde = fecha,
     Dias = 1. Verifica TODO leyendo de vuelta (Hasta tiene que quedar = fecha).
  5. Guardar -> relee la grilla y confirma el EXAMEN en esa fecha.
  --dry-run: hace 1..4 y NO guarda: descarta con "Up" y al volver a Ficheros
  contesta NO a "desea guardar".

Cola: tabla cola_examen_siape (mig 058), se llena leyendo SIAPE.xlsx.
Detalle por agente: script_run_items (pagina Robots). Correr con run_robot.py
(registra la corrida y respeta el turno de los robots de SIAPE).

Uso:
  python cargar_examen_siape.py --solo-cola           # arma la cola y lista, sin tocar SIAPE
  python cargar_examen_siape.py --dry-run --limit 1   # prueba en vivo SIN guardar
  python cargar_examen_siape.py                       # carga todos los pendientes
  python cargar_examen_siape.py --dni 30063584
"""
import argparse
import sys
import time
import unicodedata
from datetime import date, timedelta

import pandas as pd

import cargar_stress_jab as R          # mecanica JAB probada (click, WM, guardar)
import cargar_francos_siape as F       # sesion, Ficheros, pestanas, dialogos
from cargar_francos_siape import log, cerrar_modales

MN = R.MN
SCRIPT_ID = "siape_carga_examen"
SIAPE_XLSX = r"D:\G\comparacion\SIAPE\SIAPE.xlsx"
FRAME_AG = "Novedades de Ausentismo"
LICENCIA = "EXAMEN"


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())


def _fecha(v):
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, (int, float)):
        return (pd.Timestamp("1899-12-30") + pd.Timedelta(days=float(v))).date()
    try:
        return pd.Timestamp(v).date()
    except Exception:
        return None


# ───────────────────────── cola ─────────────────────────

def examenes_faltantes(path=SIAPE_XLSX):
    """[(dni, fecha_examen, apellido, nombre, pre_desde, pre_hasta)] con la regla del comparador."""
    df = pd.read_excel(path)
    filas = []
    for _, r in df.iterrows():
        try:
            dni = str(int(r["NRO_DOCUMENTO"]))
        except Exception:
            continue
        d1, d2 = _fecha(r.get("FECHA_DESDE")), _fecha(r.get("FECHA_HASTA"))
        if not d1:
            continue
        filas.append((dni, norm(r.get("NOVEDAD")), d1, d2 or d1,
                      str(r.get("APELLIDO", "") or "").strip(), str(r.get("NOMBRE", "") or "").strip()))
    por_dni = {}
    for f in filas:
        por_dni.setdefault(f[0], []).append(f)

    def cubre(f, dia):
        return f[2] <= dia <= f[3]

    out, vistos = [], set()
    for dni, nov, d1, d2, ape, nom in filas:
        if nov != "PRE-EXAMEN":
            continue
        dia = d2 + timedelta(days=1)
        del_agente = por_dni.get(dni, [])
        if any(f[1] == "PRE-EXAMEN" and cubre(f, dia) for f in del_agente):
            continue    # pre-examen partido en filas: el dia siguiente sigue siendo pre-examen
        if any(f[1] == "EXAMEN" and cubre(f, dia) for f in del_agente):
            continue
        if (dni, dia) in vistos:
            continue
        vistos.add((dni, dia))
        out.append((dni, dia, ape, nom, d1, d2))
    return out


def armar_cola(cn):
    nuevos = 0
    with cn.cursor() as c:
        for dni, dia, ape, nom, d1, d2 in examenes_faltantes():
            c.execute("INSERT IGNORE INTO cola_examen_siape (dni, fecha, apellido, nombre, pre_desde, pre_hasta) "
                      "VALUES (%s,%s,%s,%s,%s,%s)", (dni, dia, ape, nom, d1, d2))
            nuevos += c.rowcount
    cn.commit()
    return nuevos


def traer(cn, solo_dni=None, limit=None):
    sql = "SELECT * FROM cola_examen_siape WHERE estado = 'pendiente'"
    params = []
    if solo_dni:
        sql = "SELECT * FROM cola_examen_siape WHERE dni = %s AND estado <> 'cargado'"
        params = [solo_dni]
    sql += " ORDER BY fecha, dni"
    if limit:
        sql += " LIMIT %s"
        params.append(int(limit))
    with cn.cursor() as c:
        c.execute(sql, params)
        return c.fetchall()


def marcar(cn, r, estado, motivo):
    with cn.cursor() as c:
        c.execute("UPDATE cola_examen_siape SET estado=%s, motivo=%s, intentos=intentos+1 "
                  "WHERE dni=%s AND fecha=%s", (estado, (motivo or "")[:500] or None, r["dni"], r["fecha"]))
    cn.commit()
    MN.registrar_item(SCRIPT_ID, r["dni"], f"{r.get('apellido') or ''}, {r.get('nombre') or ''}".strip(", "),
                      "EXAMEN (tras pre-examen)", f"{r['fecha']:%d/%m/%Y}", f"{r['fecha']:%d/%m/%Y}",
                      {"cargado": "ok", "ya_estaba": "aviso"}.get(estado, estado), motivo)


# ───────────────────────── pantalla del agente ─────────────────────────

def _frame_agente():
    for el, _d, i in F._jab_walk(max_depth=14, max_segundos=25):
        if (i.get("role") == "internal frame" and (i.get("name") or "") == FRAME_AG
                and (i.get("bounds") or {}).get("x", -1) >= 0):
            return el
    return None


def _agente_activo():
    """True si la pantalla del agente es la ACTIVA. OJO: F._en_ficheros() da True
    aunque Ficheros este tapado por el agente (su FILTRAR sigue con bounds)."""
    for _el, _d, i in F._jab_walk(max_depth=14, max_segundos=25):
        if (i.get("role") == "internal frame" and (i.get("name") or "") == FRAME_AG
                and (i.get("bounds") or {}).get("x", -1) >= 0):
            return "activo" in (i.get("states") or [])
    return False


def leer_edicion(frame):
    """Campos del registro en edicion (arriba de la pestana LICENCIAS).
    Devuelve dict con valores + 'justificado' (bool) + los elementos."""
    out = {"el": {}}
    # sin banda_y: podaba el contenedor y se perdia el campo Licencia-Permiso
    for el, _d, i in F._jab_walk(max_depth=30, max_nodes=6000, root=frame, max_segundos=90):
        b = i.get("bounds") or {}
        if b.get("x", -1) < 0 or not (190 <= b.get("y", 0) <= 270) or b.get("x", 0) > 520:
            continue
        nom = (i.get("name") or "").strip()
        rol = i.get("role")
        clave = None
        if rol == "text" and nom.endswith("Licencia-Permiso"):
            clave = "xxxxxxx"
        elif rol == "text" and nom in ("Año", "Ano", "A\ufffdo"):
            clave = "xxxxxxx"
        elif rol == "text" and nom == "Desde":
            clave = "xxxxxxx"
        elif rol == "text" and nom.strip().startswith("D") and nom.strip().endswith("as"):
            clave = "xxxxxxx"
        elif rol == "text" and nom == "Hasta":
            clave = "xxxxxxx"
        elif rol == "check box" and nom.startswith("JUSTIFICADO"):
            st = i.get("states") or []
            st = st if isinstance(st, list) else [st]
            # mapeado en vivo: tildado = 'activado' aparece DOS veces en los estados
            out["justificado"] = st.count("activado") >= 2
            out["el"]["justificado"] = (el, i)
            continue
        if clave:
            out[clave] = (F._jab_read_text(el) or "").strip()
            out["el"][clave] = (el, i)
            st = i.get("states") or []
            if "enfocado" in (st if isinstance(st, list) else [st]):
                out["foco"] = clave
    return out


def leer_grilla(frame):
    """Filas visibles de la grilla de licencias: [(licencia, desde, hasta)]."""
    cols = {}
    for el, _d, i in F._jab_walk(max_depth=30, max_nodes=6000, root=frame, max_segundos=90):
        b = i.get("bounds") or {}
        y = b.get("y", -1)
        if b.get("x", -1) < 0 or not (310 <= y <= 470) or b.get("x", 0) > 520:
            continue
        nom = (i.get("name") or "").strip()
        if nom == "Licencia-Permiso":
            cols.setdefault(y, {})["lic"] = (F._jab_read_text(el) or "").strip()
        elif nom == "Desde Necesario":
            cols.setdefault(y, {})["desde"] = (F._jab_read_text(el) or "").strip()
        elif nom == "Hasta Necesario":
            cols.setdefault(y, {})["hasta"] = (F._jab_read_text(el) or "").strip()
    return [(v.get("lic", ""), v.get("desde", ""), v.get("hasta", "")) for _y, v in sorted(cols.items())]


def _boton_barra(nombre, intentos=3):
    for _ in range(intentos):
        for el, _d, i in F._jab_walk(max_depth=12, max_segundos=30, banda_y=(40, 75)):
            if i.get("role") == "push button" and (i.get("name") or "") == nombre:
                return el
        time.sleep(1)
    return None


def elegir_licencia_exacta(frame, licencia=LICENCIA):
    """Licencia por el selector '...' eligiendo la opcion EXACTA. Escribir el
    texto en el campo NO sirve: se ve 'EXAMEN' pero SIAPE resuelve el codigo por
    coincidencia y guardo PRE-EXAMEN (prueba 26/09/2026)."""
    btn = None
    for _ in range(3):
        for el, _d, i in F._jab_walk(max_depth=30, max_nodes=6000, root=frame, max_segundos=60):
            b = i.get("bounds") or {}
            if (i.get("role") == "push button" and (i.get("name") or "") == "..."
                    and 190 <= b.get("y", 0) <= 215 and b.get("x", 0) > 400):
                btn = el
                break
        if btn:
            break
    if not btn:
        raise RuntimeError("No encuentro el '...' de Licencia-Permiso.")
    btn.click(simulate=False)
    time.sleep(R.PAUSA_LARGA)
    # Mapeado en vivo: abre un modal SIN titulo (no 'Licencias y Permisos' como en
    # Tiempo Acumulado) con ' Buscar', 'Buscar ALT B', 'Aceptar ALT A' y una lista
    # de labels 'Descripcion:<LICENCIA>'. Buscando EXAMEN queda UNA sola opcion
    # exacta y Aceptar la toma (26/09/2026, MARTINEZ 14/09 cargado asi).
    lf = None
    for _ in range(10):
        for el, _d, i in F._jab_walk(max_depth=14, max_segundos=30):
            if (i.get("role") == "internal frame" and not (i.get("name") or "").strip()
                    and "modal" in (i.get("states") or [])):
                lf = el
                break
        if lf:
            break
        time.sleep(1)
    if not lf:
        raise RuntimeError("El '...' no abrio el selector de licencias.")
    cel, _c = R._find(lf, name=" Buscar", role="text")
    if not cel:
        raise RuntimeError("No encuentro el campo Buscar del selector.")
    R._tipear(cel, licencia)
    bel, _b = R._find(lf, name="Buscar ALT B", role="push button")
    R._click(bel)
    time.sleep(R.PAUSA_LARGA)
    opciones = []
    for _el, _d, i in F._jab_walk(max_depth=30, max_nodes=3000, root=lf, max_segundos=60):
        nom = i.get("name") or ""
        if i.get("role") == "label" and nom.startswith("Descripcion:"):
            opciones.append(nom.split(":", 1)[1].strip())
    if [norm(o) for o in opciones] != [norm(licencia)]:
        cl, _x = R._find(lf, name="Cancelar ALT C", role="push button")
        R._click(cl)
        raise RuntimeError(f"El selector no dejo SOLO '{licencia}': {opciones}. Cancelo.")
    ael, _a = R._find(lf, name="Aceptar ALT A", role="push button")
    if not R._click(ael):
        raise RuntimeError("No pude Aceptar en el selector de licencias.")
    time.sleep(R.PAUSA_MEDIA)
    cerrar_modales()
    log(f"   licencia elegida por selector: {licencia}")


def _escribir_con_foco(frame, clave, valor, tabs_max=3):
    """Escribe `valor` SOLO si el campo `clave` tiene el foco (estado 'enfocado'
    por JAB). Si no lo tiene, avanza con TAB (sin escribir) hasta tabs_max veces.
    Nunca escribe en un campo que no es el destino: el WM_CHAR limpia y pisa el
    campo enfocado (asi la fecha termino en Año en la primera prueba).
    Devuelve el valor leido de vuelta."""
    for intento in range(tabs_max + 1):
        ed = leer_edicion(frame)
        if ed.get("foco") == clave:
            R._frente_liviano()
            R._wm_type(str(valor))
            time.sleep(R.PAUSA_CORTA)
            leido = (leer_edicion(frame).get(clave) or "").strip()
            log(f"   {clave} <- {valor}: leo '{leido}'")
            return leido
        log(f"   foco en '{ed.get('foco')}', no en '{clave}': TAB ({intento + 1}/{tabs_max})")
        if intento < tabs_max:
            R._frente_liviano()
            R._wm_tab()
            time.sleep(R.PAUSA_CORTA)
    raise RuntimeError(f"No pude llevar el foco a '{clave}' (no escribo a ciegas).")


def _escribir(el_info, valor):
    """Foco por click en el campo + WM_CHAR (autolimpia) + lectura de vuelta."""
    el, _i = el_info
    R._frente_liviano()
    R._click(el, simulate=True)
    time.sleep(R.PAUSA_CORTA)
    R._wm_type(str(valor))
    R._wm_tab()
    time.sleep(R.PAUSA_CORTA)
    return (F._jab_read_text(el) or "").strip()


def abrir_agente(r):
    """Deja abierta la pestana LICENCIAS del agente, verificando el nombre."""
    if _agente_activo():
        volver_a_ficheros(guardar=False)
        if _agente_activo():
            raise RuntimeError("No pude volver a Ficheros desde la pantalla del agente anterior.")
    buscado = norm(f"{r['apellido']} {r['nombre']}")
    F._buscar_agente_en_ficheros_jab(f"{r['apellido']} {r['nombre']}")
    time.sleep(R.PAUSA_MEDIA)
    cerrar_modales()
    _c, info = F._jab_buscar(nombre="APELLIDO y NOMBRE", role="text", timeout=20, banda_y=(100, 150))
    en_pantalla = norm(F._jab_read_text(_c) if _c else "")
    if en_pantalla != buscado:
        raise RuntimeError(f"Se abrio '{en_pantalla}' y buscaba '{buscado}'. Freno (no cargo a otra persona).")
    if not F._jab_select_tab("LICENCIAS"):
        raise RuntimeError("No pude abrir la pestana LICENCIAS.")
    time.sleep(R.PAUSA_MEDIA)
    cerrar_modales()
    frame = _frame_agente()
    if not frame:
        raise RuntimeError("No encuentro la pantalla Novedades de Ausentismo del agente.")
    return frame


def volver_a_ficheros(guardar=False):
    """Vuelve a Ficheros. Si SIAPE pregunta por cambios sin guardar: en dry-run
    (guardar=False) contesta NO."""
    _b, info = F._jab_buscar(nombre="Volver a Ficheros Alt V", role="push button", timeout=10)
    if info:
        R._click(_b)
        time.sleep(R.PAUSA_MEDIA)
    for _ in range(3):
        texto, _bs = F.leer_dialogo_jab(max_segundos=5)
        if not texto:
            break
        t = norm(texto)
        if "GUARDAR" in t or "CAMBIOS" in t:
            F.cerrar_dialogo_jab(preferidos=("Si", "Sí") if guardar else ("No", "NO", "No ALT N"))
        else:
            cerrar_modales()
        time.sleep(R.PAUSA_CORTA)


class RegistroAbierto(RuntimeError):
    """Fallo con el registro nuevo a medio completar: NO se intenta salir (las
    validaciones de SIAPE traban la pantalla). Se frena la corrida y se avisa."""


def cargar_uno(r, dry_run=False):
    fecha = r["fecha"]
    f_txt = f"{fecha:%d/%m/%Y}"
    frame = abrir_agente(r)

    # 2. no duplicar: EXAMEN ya cargado en esa fecha
    grilla = leer_grilla(frame)
    if any(norm(l) == "EXAMEN" and d == f_txt for l, d, _h in grilla):
        return "ya_estaba", f"Ya tenia EXAMEN el {f_txt} en SIAPE"

    # 3. registro nuevo: foco en el bloque (Ano) + Agregar por accion JAB pura
    ed = leer_edicion(frame)
    if "anio" in ed["el"]:
        R._click(ed["el"]["anio"][0], simulate=True)
        time.sleep(R.PAUSA_CORTA)
    ag = _boton_barra("Agregar")
    if not ag:
        raise RuntimeError("No encuentro el boton Agregar (+).")
    ag.click(simulate=False)
    time.sleep(2.5)
    cerrar_modales()
    ed = leer_edicion(frame)
    if ed.get("licencia") or ed.get("desde"):
        raise RuntimeError(f"Agregar no dejo un registro en blanco (lic='{ed.get('licencia')}', desde='{ed.get('desde')}').")

    try:
        return _completar_y_guardar(frame, r, fecha, f_txt, dry_run)
    except RegistroAbierto:
        raise
    except Exception as e:
        raise RegistroAbierto(str(e)) from e


def _completar_y_guardar(frame, r, fecha, f_txt, dry_run):
    ed = leer_edicion(frame)
    # 4. completar. Solo la Licencia se enfoca por click (probado); el resto se
    #    recorre con TAB y se escribe unicamente si el campo destino tiene el foco.
    elegir_licencia_exacta(frame)
    if norm(leer_edicion(frame).get("licencia")) != LICENCIA:
        raise RuntimeError("La licencia no quedo en EXAMEN.")
    # Año tiene autoskip (4 digitos -> salta solo a Desde): NO se tabula despues
    # de escribir; _escribir_con_foco tabula solo si el foco no esta en el destino.
    if _escribir_con_foco(frame, "anio", fecha.year, tabs_max=7) != str(fecha.year):
        raise RuntimeError("El Año no quedo bien.")
    if _escribir_con_foco(frame, "desde", f_txt, tabs_max=7) != f_txt:
        raise RuntimeError("Desde no quedo bien.")
    if _escribir_con_foco(frame, "dias", 1, tabs_max=7) != "1":
        raise RuntimeError("Días no quedo en 1.")
    R._wm_tab()                                  # SIAPE calcula Hasta
    time.sleep(R.PAUSA_MEDIA)
    cerrar_modales()
    ed = leer_edicion(frame)
    if ed.get("justificado") and "justificado" in ed["el"]:
        R._click(ed["el"]["justificado"][0])        # destildar (tiene que ir SIN tildar)
        time.sleep(R.PAUSA_CORTA)
        ed = leer_edicion(frame)

    probl = []
    if norm(ed.get("licencia")) != LICENCIA:
        probl.append(f"Licencia='{ed.get('licencia')}'")
    if ed.get("anio") != str(fecha.year):
        probl.append(f"Año='{ed.get('anio')}'")
    if ed.get("desde") != f_txt:
        probl.append(f"Desde='{ed.get('desde')}'")
    if ed.get("dias") != "1":
        probl.append(f"Días='{ed.get('dias')}'")
    if ed.get("hasta") != f_txt:
        probl.append(f"Hasta='{ed.get('hasta')}'")
    if ed.get("justificado"):
        probl.append("JUSTIFICADO quedo tildado")
    log(f"   campos: lic={ed.get('licencia')} año={ed.get('anio')} desde={ed.get('desde')} "
        f"dias={ed.get('dias')} hasta={ed.get('hasta')} justificado={ed.get('justificado')}")

    if probl or dry_run:
        up = _boton_barra("Up")
        if up:
            up.click(simulate=False)             # salir del registro nuevo sin guardar
            time.sleep(2)
            cerrar_modales()
        volver_a_ficheros(guardar=False)
        if probl:
            return "error", "Verificacion fallida, NO guardo: " + "; ".join(probl)
        return "dry_run", f"DRY-RUN OK: EXAMEN {f_txt} verificado y descartado sin guardar"

    # 5. guardar y confirmar en la grilla
    ok, motivo = R._guardar()
    if not ok:
        volver_a_ficheros(guardar=False)
        return ("ya_estaba" if "ya exist" in motivo else "error"), motivo
    time.sleep(R.PAUSA_MEDIA)
    grilla = leer_grilla(_frame_agente() or frame)
    confirmado = any(norm(l) == "EXAMEN" and d == f_txt for l, d, _h in grilla)
    volver_a_ficheros(guardar=False)
    if not confirmado:
        return "error", "Guarde pero no veo el EXAMEN en la grilla: revisar a mano"
    return "cargado", f"EXAMEN {f_txt} cargado sin justificar (tras pre-examen {r['pre_desde']:%d/%m}–{r['pre_hasta']:%d/%m})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dni")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true", help="completa y verifica pero NO guarda")
    ap.add_argument("--solo-cola", action="store_true", help="arma la cola y lista, sin tocar SIAPE")
    args = ap.parse_args()

    cn = R.conn()
    nuevos = armar_cola(cn)
    pend = traer(cn, solo_dni=args.dni, limit=args.limit)
    log(f"Cola: {nuevos} nuevo(s); {len(pend)} para procesar")
    for r in pend:
        log(f"  {r['dni']}  {r['apellido']}, {r['nombre']}  EXAMEN {r['fecha']:%d/%m/%Y} "
            f"(pre {r['pre_desde']:%d/%m}–{r['pre_hasta']:%d/%m})")
    if args.solo_cola or not pend:
        return 0

    R.pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    if not F._buscar_ventana_siape():
        R._pre_login_sin_jab()
    F.asegurar_sesion()
    cerrar_modales()

    errores = 0
    for r in pend:
        log(f"-> {r['dni']} {r['apellido']} EXAMEN {r['fecha']:%d/%m/%Y}" + (" [DRY-RUN]" if args.dry_run else ""))
        try:
            estado, motivo = cargar_uno(r, dry_run=args.dry_run)
        except RegistroAbierto as e:
            motivo = (f"{e} — QUEDO EL REGISTRO NUEVO SIN GUARDAR EN PANTALLA: descartarlo a mano "
                      f"(X roja / No guardar). Freno la corrida.")[:500]
            log(f"   ERROR: {motivo}")
            if not args.dry_run:
                marcar(cn, r, "error", motivo)
            else:
                MN.registrar_item(SCRIPT_ID, r["dni"], f"{r['apellido']}, {r['nombre']}", "EXAMEN (dry-run)",
                                  f"{r['fecha']:%d/%m/%Y}", f"{r['fecha']:%d/%m/%Y}", "error", motivo)
            errores += 1
            break
        except Exception as e:
            estado, motivo = "error", str(e)[:400]
            cerrar_modales()
            try:
                volver_a_ficheros(guardar=False)
            except Exception:
                pass
        log(f"   {estado}: {motivo}")
        if estado == "dry_run":
            MN.registrar_item(SCRIPT_ID, r["dni"], f"{r['apellido']}, {r['nombre']}", "EXAMEN (dry-run)",
                              f"{r['fecha']:%d/%m/%Y}", f"{r['fecha']:%d/%m/%Y}", "aviso", motivo)
            continue
        marcar(cn, r, estado, motivo)
        errores += estado == "error"
    cn.close()
    log(f"Listo: {len(pend)} procesado(s), {errores} con error.")
    return 1 if errores else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Cancelado.")
        sys.exit(130)
