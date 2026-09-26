# -*- coding: utf-8 -*-
"""Corrector de dias de ANUAL COMPLEMENTARIA (stress) ya cargados de mas.

COPIA del robot que carga (cargar_stress_jab.py) pero que en vez de AGREGAR una
fila, CORRIGE los dias de la fila 2025 que ya existe (baja 12 -> 6/9 segun la
regla de antiguedad). Reutiliza TODO el framework del loader (login, abrir TA,
buscar persona, celdas, guardar); NO reimplementa navegacion.

Lee la cola de correccion de la tabla `cola_correccion_stress` (dni, dias_actual,
dias_correcto). Para cada agente:
  1) abre TA, selecciona la persona (igual que el loader)
  2) GUARDA DE SEGURIDAD: lee la fila 1. Solo corrige si Año=2025 y la licencia
     es ANUAL COMPLEMENTARIA y los dias == dias_actual (los de mas). Si no
     coincide (la grilla no trajo la fila existente, o el valor no es el
     esperado) -> NO toca nada y saltea. Asi NUNCA crea un duplicado.
  3) reescribe los dias al valor correcto (reusa set_anio_dias con año=2025) y
     guarda.

Uso:
  python corregir_stress_jab.py --dry-run          # lista lo que haria
  python corregir_stress_jab.py --dni 32011386     # uno solo (recomendado 1ra vez)
  python corregir_stress_jab.py                    # toda la cola pendiente
"""
import argparse
import sys
import time

import cargar_stress_jab as R
MN = R.MN  # detalle por agente para la pagina Robots (script_run_items)
import cargar_francos_siape as F
from cargar_francos_siape import log, PAUSA_CORTA, PAUSA_MEDIA

try:
    import pyautogui
except ImportError:
    pyautogui = None

TAB_CDIAS = 5   # TABs desde el inicio de la fila hasta C.Días (con 4 cae en Año -> Días=5)


def _type_raw(texto):
    """Tipea SOLO WM_CHAR, SIN backspaces (el clear de 20 backspaces de _wm_type
    cascadea hacia campos de la izquierda y ensucia Legajo). Requiere el campo YA
    enfocado y su contenido seleccionado (TAB-in lo autoselecciona + Ctrl+A)."""
    import win32api, win32con
    hwnd = R._hwnd_siape()
    if not hwnd:
        return
    for ch in str(texto):
        win32api.PostMessage(hwnd, win32con.WM_CHAR, ord(ch), 0)
        time.sleep(0.05)


def _clear_campo():
    """Borra el contenido del campo actual: Home (al inicio) + varios DELETE (borra
    HACIA ADELANTE). Delete no cascadea a la izquierda (a diferencia de Backspace,
    que se comía Legajo). Los días son <=2 dígitos; con 4 deletes alcanza."""
    import win32api, win32con
    hwnd = R._hwnd_siape()
    if not hwnd:
        return
    win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_HOME, 0)
    win32api.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_HOME, 0)
    time.sleep(0.04)
    for _ in range(4):
        win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_DELETE, 0)
        win32api.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_DELETE, 0)
        time.sleep(0.03)
    time.sleep(0.03)


def traer(cn, solo_dni=None, limit=None):
    if solo_dni:
        sql = "SELECT dni,anio,apellido,licencia,dias_actual,dias_correcto FROM cola_correccion_stress WHERE dni=%s"
        p = [solo_dni]
    else:
        sql = ("SELECT dni,anio,apellido,licencia,dias_actual,dias_correcto FROM cola_correccion_stress "
               "WHERE estado='pendiente'")
        p = []
    sql += " ORDER BY dni"
    if limit:
        sql += " LIMIT %s"; p.append(limit)
    with cn.cursor() as c:
        c.execute(sql, p); return c.fetchall()


def marcar(cn, dni, anio, estado, motivo=None):
    MN.registrar_item("siape_corrector_stress", dni, None, "ANUAL COMPLEMENTARIA (corrección)",
                      f"año {anio}", None, estado, motivo)
    with cn.cursor() as c:
        c.execute("UPDATE cola_correccion_stress SET estado=%s, motivo=%s WHERE dni=%s AND anio=%s",
                  (estado, motivo, dni, anio))
    cn.commit()


def _tok(s):
    return set((s or "").upper().replace(",", " ").split())


def _consultar_persona(frame, apellido):
    """Escribe el apellido+nombre en el campo 'Apellido y Nombre' de arriba y
    ejecuta la consulta con TAB (asi la grilla trae las filas YA cargadas de la
    persona). Devuelve el frame TA (refrescado)."""
    campo = None
    for el, d, info in F._jab_walk(root=frame, max_depth=20, max_segundos=25):
        if (info.get("role") or "") != "text":
            continue
        nom = (info.get("name") or "").strip().upper()
        b = info.get("bounds") or {}
        if nom.startswith("APELLIDO Y NOMBRE") and (b.get("y") or 999) < 220:
            campo = el; break
    if not campo:
        raise RuntimeError("No encuentro el campo de consulta 'Apellido y Nombre'.")
    R._frente_liviano()
    try:
        campo.request_focus()
    except Exception:
        pass
    R._click(campo, simulate=True)
    time.sleep(0.3)
    R._wm_type(str(apellido))
    R._wm_tab()                                # TAB ejecuta la consulta (confirmado)
    time.sleep(2.0)
    R.cerrar_modales()
    return R._find_frame(R.FRAME_TA, timeout=8) or frame


def _leer_grilla(frame):
    """Lee la grilla como filas: cada fila = dict(anio,dias,lic,apellido,el_anio).
    Agrupa los text por su coordenada Y."""
    porfila = {}
    for el, d, info in F._jab_walk(root=frame, max_depth=22, max_segundos=45):
        if (info.get("role") or "") != "text":
            continue
        b = info.get("bounds") or {}
        y = b.get("y")
        if y is None:
            continue
        nom = (info.get("name") or "").strip()
        val = (F._jab_read_text(el) or "").strip()
        x = b.get("x")
        f = porfila.setdefault(y, {"anio": "", "dias": "", "lic": "", "apellido": "",
                                   "el_anio": None, "el_dias": None, "legajo": "", "_legx": 99999})
        if nom == "Año":
            f["anio"] = val; f["el_anio"] = el
        elif nom == "Licencia / Permiso":
            f["lic"] = val
        elif ("Día" in nom) or ("Dia" in nom) or ("x Ley" in nom):
            f["dias"] = val; f["el_dias"] = el
        elif nom.upper().startswith("APELLIDO Y NOMBRE"):
            f["apellido"] = val
        elif nom == "Legajo" or (x is not None and x < (f["_legx"] or 99999) and x < 130):
            f["legajo"] = val; f["_legx"] = x if x is not None else 99999
    filas = [porfila[y] for y in sorted(porfila)]
    return [f for f in filas if f["anio"] or f["lic"] or f["dias"]]


def _wm_down(n):
    """Baja n registros con la flecha ↓. Las flechas son teclas EXTENDIDAS: hay que
    prender el bit 24 del lParam, sino Java/Forms no las procesa como navegación."""
    import win32api, win32con
    hwnd = R._hwnd_siape()
    if not hwnd:
        return
    scan = 0x50
    lp_down = (scan << 16) | 1 | (1 << 24)
    lp_up = (scan << 16) | 1 | (1 << 24) | (1 << 30) | (1 << 31)
    for _ in range(n):
        win32api.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_DOWN, lp_down)
        time.sleep(0.04)
        win32api.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_DOWN, lp_up)
        time.sleep(0.09)


def _corregir_una_fila(apellido, anio, quiere_fn, valor):
    """Abre TA, consulta la persona, ubica la fila objetivo, NAVEGA hasta ella
    bajando registros desde la PRIMERA fila (clic confiable en la fila de arriba +
    ↓ x idx) y reescribe C.Días del registro ACTUAL. Un cambio por ciclo (para no
    arrastrar el 'registro actual', que era la causa de que el 0 cayera en la fila
    equivocada). Verifica releyendo la grilla y guarda. Devuelve (estado, motivo)."""
    frame = R.abrir_ta()
    if not frame:
        return "error", "no abri TA"
    R.cerrar_modales()
    frame = _consultar_persona(frame, apellido)
    filas = _leer_grilla(frame)
    if not filas:
        return "saltado", "grilla vacia tras consultar"
    idx = next((i for i, f in enumerate(filas) if quiere_fn(f)), None)
    if idx is None:
        return "saltado", "no encuentro la fila objetivo en la grilla"
    R._frente_liviano()
    # 1) foco en la grilla: clic en la PRIMERA fila (arriba -> clic confiable, con la
    #    sesión RDP CONECTADA). NO se tocan filas profundas: eso selecciona la fila
    #    entera y devuelve el cursor a la fila 1.
    if filas[0].get("el_anio"):
        R._click(filas[0]["el_anio"], simulate=True)
        time.sleep(PAUSA_CORTA)
    # 2) BAJO idx registros con ↓ -> el objetivo es el REGISTRO ACTUAL (esto anda)
    _wm_down(idx)
    time.sleep(PAUSA_CORTA)
    # 3) "paso a Días" SOLO por teclado. El nº de TABs DEPENDE del Legajo: si tiene
    #    número es read-only (NO es tab-stop) -> Días a 4 TABs; si está vacío es
    #    editable (tab-stop) -> Días a 5 TABs. (Dato del usuario: "te pasás cuando el
    #    legajo tiene número".) Sin clics profundos.
    leg_target = str(filas[idx].get("legajo", "")).strip()
    ntabs = 4 if leg_target else 5
    for _ in range(ntabs):
        R._wm_tab()
    # 4) reemplazo el valor: borro con Home+Delete (hacia adelante, sin cascada) y tipeo
    _clear_campo()
    _type_raw(str(valor))
    time.sleep(PAUSA_CORTA)
    filas2 = _leer_grilla(R._find_frame(R.FRAME_TA, timeout=8) or frame)
    if idx >= len(filas2):
        return "error", "la grilla cambio de tamaño tras editar"
    got = (filas2[idx]["dias"] or "").strip()
    anio_got = str(filas2[idx]["anio"]).strip()
    leg_before = str(filas[idx].get("legajo", "")).strip()
    leg_after = str(filas2[idx].get("legajo", "")).strip()
    log(f"   [DBG] post-edit idx{idx}: Legajo '{leg_before}'->'{leg_after}' Año='{anio_got}' Días='{got}' (esp {valor})")
    try:
        ok = (int(float(got)) == valor and anio_got == str(anio)   # días OK + Año intacto
              and leg_after == leg_before)                          # + Legajo NO ensuciado
    except ValueError:
        ok = False
    if not ok:
        return "error", f"no aterrizo/ensucio: Días='{got}' Año='{anio_got}' Legajo '{leg_before}'->'{leg_after}' -> NO guardo"
    okg, motg = R._guardar()
    if okg and motg == "GUARDADO":
        return "ok", None
    return "error", f"guardar: {motg}"


def corregir_uno(dni, anio, apellido, licencia, dias_actual, dias_correcto):
    R._traer_al_frente()
    # 1) LEER una vez para decidir el plan (sin editar nada)
    frame = R.abrir_ta()
    if not frame:
        raise RuntimeError("No pude abrir Tiempo Acumulado.")
    R.cerrar_modales()
    frame = _consultar_persona(frame, apellido)
    filas = _leer_grilla(frame)
    log(f"   grilla: {len(filas)} filas para '{apellido}'")
    toks = _tok(apellido)

    def es_target(f):
        # el grid rotula "ANUAL COMPLEMENTARIA (BECARIOS)"/"... 10430"/"... X" -> prefijo
        return (str(f["anio"]).strip() == str(anio)
                and f["lic"].strip().upper().startswith("ANUAL COMPLEMENTARIA")
                and (not toks or toks.issubset(_tok(f["apellido"]))))

    def diaint(f):
        try:
            return int(float(f["dias"])) if f["dias"] not in ("", None) else None
        except ValueError:
            return None

    cand = [f for f in filas if es_target(f)]
    R._recuperar()                              # cierro este TA de LECTURA (no toqué nada)

    if not cand:
        return "saltado", f"no hay fila {anio} ANUAL COMPLEMENTARIA para {apellido} (¿vacío/otra variante?)"

    # REGLA (usuario):
    #  - 1 sola fila   -> los días por antigüedad (dias_correcto).
    #  - DUPLICADA (2+) -> TODAS a 0 (el 0 = ya se la tomó; no se le vuelven a dar).
    if len(cand) == 1:
        di = diaint(cand[0])
        if di == dias_correcto:
            return "corregido", f"ya ok (1 fila en {dias_correcto})"
        if di != dias_actual:
            return "saltado", f"1 fila en {di} (esperaba {dias_actual}) -> no toco, revisar"
        est, mot = _corregir_una_fila(apellido, anio, es_target, dias_correcto)
        return ("corregido", f"{dias_actual} -> {dias_correcto}") if est == "ok" else (est, mot)

    # duplicada -> cada fila 2025 AC con días>0 va a 0, UNA por ciclo (re-consulta fresca)
    nonzero = [f for f in cand if (diaint(f) or 0) != 0]
    if not nonzero:
        return "corregido", f"ya ok (duplicada, {len(cand)} filas en 0)"
    hechos = 0
    for _ in nonzero:
        est, mot = _corregir_una_fila(
            apellido, anio, lambda f: es_target(f) and (diaint(f) or 0) > 0, 0)
        if est != "ok":
            return est, f"dup parcial ({hechos}/{len(nonzero)} a 0): {mot}"
        hechos += 1
    return "corregido", f"DUPLICADA ({len(cand)} filas) -> {hechos} a 0"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dni", type=int)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    cn = R.conn()
    pend = traer(cn, solo_dni=args.dni, limit=args.limit)
    log(f"{len(pend)} en cola de correccion")
    for r in pend:
        log(f"  {r['dni']}  {r['apellido']:<30} {r['dias_actual']} -> {r['dias_correcto']}")
    if args.dry_run:
        log("--dry-run"); return
    if pyautogui is None:
        raise RuntimeError("Falta pyautogui")
    pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE

    if not F._buscar_ventana_siape():
        R._pre_login_sin_jab()
    F.asegurar_sesion(); R.cerrar_modales(); F.ventana_siape()
    pyautogui.PAUSE = PAUSA_CORTA

    ok = err = skip = 0
    for r in pend:
        log(f"-- {r['dni']} {r['apellido']} ({r['dias_actual']}->{r['dias_correcto']}) -----")
        try:
            estado, motivo = corregir_uno(r["dni"], r["anio"], r["apellido"], r["licencia"],
                                          r["dias_actual"], r["dias_correcto"])
            marcar(cn, r["dni"], r["anio"], estado, motivo)
            if estado == "corregido":
                ok += 1; log(f"   OK {motivo}")
            elif estado == "saltado":
                skip += 1; log(f"   SALTADO: {motivo}")
            else:
                err += 1; log(f"   ERROR: {motivo}")
            try:
                R._recuperar()
            except Exception as e2:
                log(f"   (recuperacion: {e2})"); R.cerrar_modales()
        except Exception as e:
            marcar(cn, r["dni"], r["anio"], "error", str(e)[:200]); err += 1
            log(f"   EXCEPCION: {e}")
            if "No encuentro la ventana" in str(e) or "no abrio" in str(e).lower():
                log("   SIAPE perdido: re-abro y re-logueo...")
                try:
                    F.asegurar_sesion(); R.cerrar_modales(); F.ventana_siape()
                except Exception as e3:
                    log(f"   (no pude re-establecer SIAPE: {e3})")
            else:
                try:
                    R._recuperar()
                except Exception as e2:
                    log(f"   (recuperacion fallo: {e2})"); R.cerrar_modales()
    cn.close()
    log(f"Listo. corregidos={ok} saltados={skip} err={err}")


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
