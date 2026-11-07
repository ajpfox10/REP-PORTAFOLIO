"""
Francos compensatorios fuera del horario del agente (regla del usuario, 02/11/2026).

Los robots que cargan FRANCO COMPENSATORIO (COMUNICACIONES) dia por dia (jefe, rotaciones,
francos de reconocimientos medicos) cargaban dias corridos: sabados/domingos de agentes que
trabajan L-V, etc. "No corresponde": solo van los dias que el agente trabaja.

- dias_fuera_de_horario(): que dias NO estan en el horario del agente (horarios_historial, foto
  mas reciente <= fecha; si no hay, la primera). Feriado = se carga. Sin horario = se carga.
  Misma regla que cargar_ausentes_intranet_v2.filtrar_franqueros.
- borrar_dia_fc(): borra en SiAPe el franco de ese dia en la ficha abierta (X roja + Guardar),
  solo si el dia tiene UN registro y es el franco. Si algo no coincide no toca nada.
- procesar_borrados(): recorre los dias a borrar agrupados por agente.

Estados que usan las colas: NO_TRABAJA_DIA (no se carga), BORRAR (el robot lo cargo y hay que
borrarlo en SiAPe), BORRADO, ERROR_BORRAR (agotados los intentos de borrado).
"""

import time
from collections import OrderedDict, defaultdict

DIAS_HORARIO = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")   # date.weekday(): 0 = lunes
MAX_INTENTOS_BORRAR = 3


def _minutos(v):
    """'08:00' / timedelta / time -> minutos desde las 00:00 (None si no se entiende)."""
    if v is None:
        return None
    if hasattr(v, "total_seconds"):
        return int(v.total_seconds() // 60) % 1440
    if hasattr(v, "hour"):
        return v.hour * 60 + v.minute
    try:
        h, m = str(v).strip().split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def dias_trabajados(h):
    """weekday() que toca el horario de una foto: el dia que entra y, si la salida es <= la
    entrada (guardia / nocturno: entra un dia y sale al otro, incl. 24 h), tambien el siguiente."""
    dias = set()
    for i, d in enumerate(DIAS_HORARIO):
        if not h.get(f"{d}_e"):
            continue
        dias.add(i)
        e, s = _minutos(h.get(f"{d}_e")), _minutos(h.get(f"{d}_s"))
        if e is not None and s is not None and s <= e:
            dias.add((i + 1) % 7)
    return dias


def dias_fuera_de_horario(cur, claves):
    """{(dni, fecha): motivo} de los (dni, fecha) de `claves` que no estan en el horario del
    agente y no son feriado. dni como int."""
    claves = [(int(d), f) for d, f in claves]
    dnis = sorted({d for d, _f in claves})
    if not dnis:
        return {}
    cur.execute("SELECT fecha FROM feriados")
    feriados = {r["fecha"] for r in cur.fetchall()}
    fotos = defaultdict(list)   # dni -> [(fecha, dias que trabaja)] por fecha
    cols = ", ".join(f"{d}_e, {d}_s" for d in DIAS_HORARIO)
    cur.execute(f"""SELECT dni, fecha, {cols} FROM horarios_historial
                     WHERE dni IN ({",".join(["%s"] * len(dnis))}) ORDER BY fecha""", dnis)
    for h in cur.fetchall():
        fotos[int(h["dni"])].append((h["fecha"], dias_trabajados(h)))
    fuera = {}
    for dni, f in claves:
        lista = fotos.get(dni)
        if not lista or f in feriados:
            continue
        dias = lista[0][1]
        for fe, d in lista:
            if fe <= f:
                dias = d
        if dias and f.weekday() not in dias:
            horario = "".join("LMXJVSD"[i] for i in sorted(dias))
            fuera[(dni, f)] = f"No trabaja ese dia: el {f:%d/%m/%Y} no esta en su horario ({horario})"
    return fuera


def agrupar_por_agente(filas):
    por_agente = OrderedDict()
    for f in filas:
        por_agente.setdefault(f["dni"], []).append(f)
    return por_agente


def _boton_borrar(F):
    """La X roja de la barra: no tiene description (JAB la llama 'Save'); es el boton que esta
    pegado a la derecha de Agregar (catalogo: Agregar x=59, X x=83, misma fila)."""
    ag = F._boton_barra("Agregar")
    if not ag:
        raise RuntimeError("no encuentro el boton Agregar de la barra (para ubicar la X de borrar)")
    b = ag["bounds"]
    _el, info = F._jab_buscar(role="push button", timeout=10, x_min=b["x"] + 16, x_max=b["x"] + 32,
                              y_min=b["y"] - 4, y_max=b["y"] + 4)
    if not info:
        raise RuntimeError("no encuentro la X de borrar a la derecha de Agregar")
    F.log(f"   boton borrar: name='{info.get('name')}' desc='{info.get('description')}' {info.get('bounds')}")
    return info


def borrar_dia_fc(F, dia):
    """Borra en la ficha abierta el FRANCO COMPENSATORIO de `dia` (X roja + Guardar).
    Solo si ese dia tiene UN registro y es el franco; si no, no toca nada (excepcion).
    Devuelve 'BORRADO' o 'YA_NO_ESTABA'."""
    filas = F.ir_a_fecha_grilla(dia)
    if filas is None:
        raise RuntimeError("no pude llegar a ese dia en la grilla; no borro nada")
    if not filas:
        return "YA_NO_ESTABA"
    if len(filas) > 1:
        raise RuntimeError(f"hay {len(filas)} novedades ese dia {[t for _f, t, _i in filas]}; no borro")
    _f, tipo, celda = filas[0]
    if not tipo.upper().startswith("FRANCO COMPENSATORIO"):
        raise RuntimeError(f"ese dia tiene '{tipo}', no el franco; no borro")
    F._jab_click_bounds(celda)                    # me paro en el registro de ese dia
    time.sleep(F.PAUSA_MEDIA)
    F.cerrar_modales()
    fecha_ficha = F._fecha_ficha_arriba()
    for intento in range(2):
        if fecha_ficha == dia.strftime("%d/%m/%Y"):
            break
        F.log(f"   arriba quedo FECHA '{fecha_ficha}', no el {dia:%d/%m/%Y}: vuelvo a clickear la fila ({intento + 1}/2)")
        b = celda.get("bounds") or {}
        F._jab_click_bounds({"bounds": {"x": b.get("x", 0) + 4, "y": b.get("y", 0) + 2,
                                        "width": max(b.get("width", 10) - 8, 4),
                                        "height": max(b.get("height", 10) - 4, 4)}})
        time.sleep(F.PAUSA_MEDIA + 1)
        F.cerrar_modales()
        fecha_ficha = F._fecha_ficha_arriba()
    if fecha_ficha != dia.strftime("%d/%m/%Y"):
        raise RuntimeError(f"arriba quedo FECHA '{fecha_ficha}', no el {dia:%d/%m/%Y}; no borro")
    tipo_arriba = F.tipo_seleccionado_root() or ""
    if not tipo_arriba.upper().startswith("FRANCO COMPENSATORIO"):
        raise RuntimeError(f"arriba quedo TIPO '{tipo_arriba}', no el franco; no borro")

    x_info = _boton_borrar(F)
    F._exigir_siape_al_frente("borro el registro")
    F._jab_click_bounds(x_info)
    time.sleep(F.PAUSA_LARGA)
    # algun "¿esta seguro?" antes de borrar -> Si (lo de "guardar cambios" lo resuelve Guardar)
    texto, _bs = F.leer_dialogo_jab(max_segundos=4)
    if texto:
        F.log(f"   aviso al borrar: {' '.join(texto.split())[:150]}")
        F.cerrar_dialogo_jab(preferidos=("Si", "Sí", "Aceptar", "OK"))
        time.sleep(F.PAUSA_MEDIA)
    g = F._boton_barra("Guardar")
    if not g:
        raise RuntimeError("borre el registro pero no encuentro Guardar (no quedo guardado)")
    F._exigir_siape_al_frente("guardo el borrado")
    F._jab_click_bounds(g)
    time.sleep(F.PAUSA_LARGA)
    ok, motivo = F._resolver_avisos(dia)
    if not ok:
        raise RuntimeError(f"SiAPe no acepto el borrado: {motivo}")
    filas2 = F.ir_a_fecha_grilla(dia) or []
    if any(t.upper().startswith("FRANCO COMPENSATORIO") for _f, t, _i in filas2):
        raise RuntimeError(f"despues de guardar la grilla sigue mostrando {[(f, t) for f, t, _i in filas2]}")
    return "BORRADO"


def procesar_borrados(F, a_borrar, marcar, registrar_item=None):
    """Borra en SiAPe los dias de `a_borrar` ({dni: [filas con id, fecha, intentos, cuil, nombre]}).
    marcar(id, estado, detalle) anota el resultado (y suma un intento).
    Devuelve {'borrados', 'errores', 'agentes_error', 'tocadas', 'corte'}; 'corte' = SiAPe no volvio."""
    res = {"borrados": 0, "errores": 0, "agentes_error": [], "tocadas": set(), "corte": None}

    def _fallo(x, detalle):
        sigue = x["intentos"] + 1 < MAX_INTENTOS_BORRAR
        marcar(x["id"], "BORRAR" if sigue else "ERROR_BORRAR", detalle)
        res["tocadas"].add(x["id"])
        res["errores"] += 1

    for dni, filas in a_borrar.items():
        nombre = filas[0]["nombre"]
        try:
            F.log(f"-- BORRAR {dni} {nombre} ({len(filas)} dia/s) ---------------------")
            if not nombre:
                for x in filas:
                    _fallo(x, "El DNI no está en personal: no lo puedo buscar en SiAPe")
                res["agentes_error"].append(f"{dni} (sin nombre)")
                continue
            F.abrir_agente_seguro(dni, filas[0]["cuil"], nombre)
            for x in filas:
                dia = x["fecha"]
                F.log(f"   borrando {dia:%d/%m/%Y}...")
                try:
                    r = borrar_dia_fc(F, dia)
                except F.SiapeCaido:
                    raise
                except Exception as e:
                    _fallo(x, f"{dia:%d/%m/%Y}: no pude borrarlo: {e}")
                    res["agentes_error"].append(f"{dni} {nombre} (borrar)")
                    F.log(f"   ERROR borrando {dia:%d/%m/%Y}: {e} -> paso al siguiente agente")
                    F.cerrar_modales()
                    break          # ficha en estado desconocido: el agente siguiente reabre Ficheros
                marcar(x["id"], "BORRADO",
                       "Borrado en SiAPe por el robot (no trabaja ese dia)" if r == "BORRADO"
                       else "Ya no estaba en SiAPe (lo borraron a mano)")
                res["tocadas"].add(x["id"])
                res["borrados"] += 1
                F.log(f"   {r} {dia:%d/%m/%Y}")
            if registrar_item:
                registrar_item(dni, nombre, filas)
        except F.SiapeCaido as e:
            res["corte"] = f"SiAPe se cayo borrando {dni} {nombre} y no pude volver a entrar: {e}"
            break
        except Exception as e:
            msg = f"{type(e).__name__}: {e}"
            F.log(f"   ERROR inesperado borrando {dni}: {msg} -> sigo con el siguiente")
            for x in filas:
                if x["id"] not in res["tocadas"]:
                    _fallo(x, f"Falla del robot: {msg}")
            res["agentes_error"].append(f"{dni} {nombre} (borrar)")
            err_s = F.entrar_siape(cerrar_antes=True)
            if err_s:
                res["corte"] = f"Despues del error borrando {dni} no pude volver a entrar a SiAPe: {err_s}"
                break
    return res
