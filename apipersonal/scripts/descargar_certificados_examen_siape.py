"""
Baja de SIAPE el CERTIFICADO DE APTITUD PSICOFISICA (examen de ingreso) de los
agentes de las tandas de nombramiento (tramites_tanda_interinos) y lo deja en
D:\\G\\DOCU\\<dni>\\Certificado Apto Psicofisico\\.

Pantalla Rec. Medicos -> Examenes Medicos (internal frame "Examenes Médicos"),
mapeada en vivo el 01/11/2026:
  - filtro DOCUMENTO (text, y<200) + CONSULTAR / BORRAR; ORGANISMO queda fijo
    en MINISTERIO DE SALUD. Sin resultados NO sale cartel: el contador de abajo
    (text en la banda de los botones) queda en "0".
  - grilla de 11 filas: celdas "text" con name = columna (CODIGO, DOCUMENTO,
    TIPO DE EXAMEN, ESTADO, RESULTADO...) + push button "Certificado" por fila
    (estado "activado" solo si hay certificado).
  - "Certificado" abre el PDF en Chrome, que lo baja a ~/Downloads con nombre
    al azar (af1b2636....pdf). El PDF trae texto: se verifica el DNI adentro
    antes de moverlo.

Flujo por agente: BORRAR -> DNI -> CONSULTAR -> elige la fila EXAMEN DE INGRESO
con resultado APTO* (si hay varias, el CODIGO mas alto) -> click REAL en su CODIGO
(Certificado actua sobre la fila seleccionada, no sobre la del boton) -> Certificado
-> si sale "no tiene certificado" lo cierra y es error -> espera el PDF nuevo en
Descargas -> verifica DNI y que el TIPO del PDF sea el de la fila -> lo mueve como
"Apto Psicofisico SIAPE <CODIGO>.pdf".
Si la subcarpeta ya tiene algun archivo (preocupacional escaneado) -> ya_estaba,
salvo --forzar, o salvo que en la tabla no tenga un apto de ingreso CON fecha: ahi
entra igual "solo para la fecha" (baja el PDF, lo lee y lo descarta).
Examen sin FECHA en SIAPE (ej. DI-063742): la fecha sale del certificado
("La Plata, <dia> de <mes> de <año>") y queda con fecha_origen='certificado' (mig 101).
Lo que lee en la grilla lo guarda en examenes_medicos_siape (origen 'pantalla').

Detalle por agente: script_run_items (pagina Robots). Correr con run_robot.py
(registra la corrida y respeta el turno de los robots de SIAPE).

Uso:
  python descargar_certificados_examen_siape.py --solo-lista        # lista, sin tocar SIAPE
  python descargar_certificados_examen_siape.py --dry-run --limit 3  # busca en SIAPE, no baja
  python descargar_certificados_examen_siape.py                      # todas las tandas
  python descargar_certificados_examen_siape.py --tanda "TANDA 1"
  python descargar_certificados_examen_siape.py --dni 12345678 --forzar
"""
import argparse
import os
import re
import shutil
import sys
import time
from pathlib import Path

import pypdf

import cargar_francos_siape as F
from cargar_francos_siape import log, cerrar_modales
import mapeo_novedades as MN

sys.path.insert(0, str(Path(__file__).resolve().parent / "siape_exportaciones"))
import examenes_medicos_tabla as EM    # upsert en examenes_medicos_siape (mig 100)

SCRIPT_ID = "siape_certificados_examen"
FRAME = "Examenes Médicos"
DOCU = Path(os.environ.get("DOCU_DIR", r"D:\G\DOCU"))
SUBCARPETA = "Certificado Apto Psicofisico"
DESCARGAS = Path(os.path.expanduser(r"~\Downloads"))
Y_FILTROS_MAX = 200          # fila de filtros (los textos de la grilla arrancan en y~250)
ESPERA_PDF = 45              # segundos


# ───────────────────────── agentes ─────────────────────────

def traer_agentes(cn, tanda=None, solo_dni=None, limit=None):
    sql = ("SELECT t.dni, MIN(t.tanda) AS tanda, MAX(p.apellido) AS apellido, MAX(p.nombre) AS nombre "
           "FROM tramites_tanda_interinos t LEFT JOIN personal p ON p.dni = t.dni")
    where, params = [], []
    if tanda:
        where.append("t.tanda = %s")
        params.append(tanda)
    if solo_dni:
        where.append("t.dni = %s")
        params.append(int(solo_dni))
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY t.dni ORDER BY MIN(t.tanda), apellido, nombre"
    with cn.cursor() as c:
        c.execute(sql, params)
        filas = c.fetchall()
    if solo_dni and not filas:
        # un DNI suelto que no esta en ninguna tanda: se baja igual
        filas = [{"dni": int(solo_dni), "tanda": None, "apellido": None, "nombre": None}]
    return filas[:limit] if limit else filas


def carpeta_destino(dni):
    return DOCU / str(dni) / SUBCARPETA


def ya_tiene(dni):
    d = carpeta_destino(dni)
    return d.is_dir() and any(p.is_file() for p in d.iterdir())


def aptos_con_fecha(cn):
    """DNIs que ya tienen en la tabla un examen APTO con fecha (ingreso o periodico: el
    periodico vigente vale igual, no hace falta buscar la fecha del ingreso)."""
    with cn.cursor() as c:
        c.execute("SELECT DISTINCT dni FROM examenes_medicos_siape WHERE fecha IS NOT NULL "
                  "AND UPPER(resolucion) LIKE 'APTO%%'")
        return {int(x["dni"]) for x in c.fetchall()}


def sin_ingreso_conocido(cn):
    """DNIs que la tabla ya conoce (exportacion o grilla) y no tienen NINGUN examen APTO (de
    ningun tipo): no se abre SIAPE por ellos en cada corrida. Si despues aparece un APTO en
    la tabla, vuelven a entrar solos. (20/11: antes pedia ingreso APTO y salteaba a los que
    solo tenian periodico, ej. GIMENEZ 29655153; ahora el periodico tambien sirve.)"""
    with cn.cursor() as c:
        c.execute("SELECT dni FROM examenes_medicos_siape GROUP BY dni HAVING "
                  "SUM(UPPER(resolucion) LIKE 'APTO%%') = 0")
        return {int(x["dni"]) for x in c.fetchall()}


def aptos_por_dni(cn):
    """{dni: [examen APTO* con fecha, del mas nuevo al mas viejo]} con certificado_archivo (mig 102)."""
    with cn.cursor() as c:
        c.execute("SELECT codigo_examen, dni, tipo_examen, fecha, certificado_archivo FROM examenes_medicos_siape "
                  "WHERE fecha IS NOT NULL AND UPPER(resolucion) LIKE 'APTO%%' ORDER BY fecha DESC")
        out = {}
        for x in c.fetchall():
            x["tiene_cert"] = bool(x["certificado_archivo"]) and Path(x["certificado_archivo"]).is_file()
            out.setdefault(int(x["dni"]), []).append(x)
        return out


def apto_nuevo_sin_bajar(aptos):
    """Si el agente YA tiene un certificado de SIAPE y aparecio un apto mas nuevo (vencido ->
    examen nuevo -> vigente), devuelve ese examen. Los que nunca tuvieron uno de SIAPE
    (preocupacional cargado a mano, solo periodico sin ingreso) siguen la regla de siempre."""
    con_cert = [a for a in aptos if a["tiene_cert"]]
    if not con_cert:
        return None
    nuevo = aptos[0]
    return None if nuevo["tiene_cert"] or nuevo["fecha"] <= con_cert[0]["fecha"] else nuevo


def nombre_ag(r):
    return f"{r.get('apellido') or ''}, {r.get('nombre') or ''}".strip(", ")


# ───────────────────────── pantalla ─────────────────────────

def abrir_pantalla():
    fr, _ = F._jab_wait_frame(FRAME, timeout=6)
    if fr:
        return fr
    F._activar_ventana(F._buscar_ventana_siape())
    _, menu = F._jab_buscar(empieza="Rec. M", role="menu", timeout=15)
    if not menu:
        raise RuntimeError("No encontre el menu 'Rec. Médicos' en SIAPE.")
    F._jab_click_bounds(menu)
    time.sleep(F.PAUSA_MEDIA)
    # mismo criterio que abrir_novedades_ausentismo: el item se elige por nemotecnico
    F.pyautogui.press("e")
    fr, _ = F._jab_wait_frame(FRAME, timeout=40)
    if not fr:
        raise RuntimeError("No se abrio la pantalla 'Examenes Médicos'.")
    return fr


def _boton(fr, nombre):
    el, _ = F._jab_find_in(fr, name=nombre, role="push button")
    if not el:
        raise RuntimeError(f"No encontre el boton {nombre} en Examenes Médicos.")
    return el


def leer_grilla(fr):
    """(contador, [fila]) — fila: dict columna->texto + '_btn' (elemento) y '_btn_ok'."""
    filas, contador = {}, None
    for el, _d, i in F._jab_walk(max_depth=30, root=fr, max_nodes=4000, max_segundos=60):
        b = i.get("bounds") or {}
        y, rol, nom = b.get("y") or -1, i.get("role"), i.get("name") or ""
        if rol == "push button" and nom == "Certificado":
            f = filas.setdefault(y, {})
            f["_btn"], f["_btn_ok"] = el, "activado" in (i.get("states") or [])
        elif rol == "text" and Y_FILTROS_MAX < y < 600 and nom:
            filas.setdefault(y, {})[nom] = F._jab_read_text(el).strip()
        elif rol == "text" and y >= 600 and not nom and (b.get("x") or 0) > 1000:
            contador = F._jab_read_text(el).strip()
    return contador, [filas[y] for y in sorted(filas) if filas[y].get("CODIGO")]


CERO_MIN_SEG = 12


def consultar(fr, dni):
    F._jab_click_element(_boton(fr, "BORRAR"))
    time.sleep(1.5)
    el, _ = F._jab_find_in(fr, name="DOCUMENTO", role="text", y_max=Y_FILTROS_MAX)
    if not el:
        raise RuntimeError("No encontre el filtro DOCUMENTO.")
    F._jab_set_text(el, str(dni))
    time.sleep(F.PAUSA_CORTA)
    if F._jab_read_text(el).strip() != str(dni):
        # a veces Forms no toma el setText de JAB (pasa tras un cartel o con el foco en la
        # grilla): plan B = click real en el campo + pegar, como los otros robots
        F._activar_ventana(F._buscar_ventana_siape())
        el, info = F._jab_find_in(fr, name="DOCUMENTO", role="text", y_max=Y_FILTROS_MAX)
        F._jab_set_text_by_bounds(info, str(dni))
        time.sleep(F.PAUSA_CORTA)
    if F._jab_read_text(el).strip() != str(dni):
        raise RuntimeError(f"El filtro DOCUMENTO no quedo con {dni} (leido: {F._jab_read_text(el).strip()!r}).")
    F._jab_click_element(_boton(fr, "CONSULTAR"))
    # espera a que la grilla muestre ese DNI o el contador quede en 0.
    # 13/11: BORRAR deja el contador en "0" y a veces se leia ANTES de que CONSULTAR
    # terminara -> "sin examenes" falso (BAEZ BALBUENA, PAJON con apto en SIAPE).
    # El "0" solo vale si sigue en 0 pasados CERO_MIN_SEG desde el CONSULTAR.
    t_consulta = time.time()
    limite = t_consulta + 30
    while True:
        time.sleep(2)
        contador, filas = leer_grilla(fr)
        if any(f.get("DOCUMENTO") == str(dni) for f in filas):
            break
        if contador == "0" and time.time() - t_consulta >= CERO_MIN_SEG:
            break
        if time.time() > limite:
            raise RuntimeError(f"CONSULTAR no trajo resultados de {dni} (contador={contador!r}).")
    otros = [f for f in filas if f.get("DOCUMENTO") != str(dni)]
    if otros:
        raise RuntimeError(f"La grilla trae otro DNI ({otros[0].get('DOCUMENTO')}); no sigo con {dni}.")
    if contador and contador.isdigit() and int(contador) > len(filas):
        log(f"   AVISO: el contador dice {contador} y veo {len(filas)} fila(s); uso las visibles.")
    return contador, filas


def _num_codigo(f):
    m = re.search(r"(\d+)", f.get("CODIGO") or "")
    return int(m.group(1)) if m else 0


def elegir_fila(filas):
    """EXAMEN DE INGRESO APTO* (CODIGO mas alto). Si no hay ingreso (20/11: GIMENEZ 29655153,
    TORRES 30264109, solo periodico), el apto PERIODICO/cualquier otro mas nuevo: el usuario
    acepta el periodico vigente como apto ("es lo mismo")."""
    aptas = [f for f in filas
             if (f.get("RESULTADO") or "").upper().startswith("APTO") and f.get("_btn_ok")]
    ingreso = [f for f in aptas if "INGRESO" in (f.get("TIPO DE EXAMEN") or "").upper()]
    elegibles = ingreso or aptas
    return max(elegibles, key=_num_codigo) if elegibles else None


def resumen(filas):
    return "; ".join(f"{f.get('CODIGO')} {f.get('TIPO DE EXAMEN')} {f.get('ESTADO')}/{f.get('RESULTADO') or '-'}"
                     for f in filas)[:400]


# ───────────────────────── descarga ─────────────────────────

def _pdfs_descargas():
    return {p: p.stat().st_mtime for p in DESCARGAS.glob("*.pdf")}


def esperar_pdf_nuevo(antes, t0):
    limite = time.time() + ESPERA_PDF
    while time.time() < limite:
        time.sleep(1)
        nuevos = [p for p, m in _pdfs_descargas().items() if p not in antes and m >= t0 - 2]
        if nuevos and not list(DESCARGAS.glob("*.crdownload")):
            p = max(nuevos, key=lambda x: x.stat().st_mtime)
            tam = -1
            while tam != p.stat().st_size:   # tamanio estable = termino de escribir
                tam = p.stat().st_size
                time.sleep(0.7)
            return p
    return None


def texto_pdf(p):
    try:
        return " ".join((pg.extract_text() or "") for pg in pypdf.PdfReader(str(p)).pages)
    except Exception as e:
        raise RuntimeError(f"No pude leer el PDF bajado ({p.name}): {e}")


def _celda_codigo(fr, codigo):
    for el, _d, i in F._jab_walk(max_depth=30, root=fr, max_nodes=4000, max_segundos=60):
        if (i.get("role") == "text" and i.get("name") == "CODIGO"
                and (i.get("bounds") or {}).get("y", 0) > Y_FILTROS_MAX
                and F._jab_read_text(el).strip() == codigo):
            return el, i
    return None, None


def seleccionar_fila(fr, codigo, intentos=3):
    """El boton Certificado actua sobre la fila SELECCIONADA de Forms (despues de CONSULTAR es
    la primera), no sobre la fila del boton: el 01/11 bajo periodicos y choco con ANULADOS por
    eso. Click REAL de mouse en la celda CODIGO (la accion JAB no existe en las celdas) y se
    verifica que esa celda quede 'enfocado'."""
    for _ in range(intentos):
        _el, info = _celda_codigo(fr, codigo)
        if not info:
            raise RuntimeError(f"No encontre la fila {codigo} en la grilla.")
        if "enfocado" in (info.get("states") or []):
            return
        F._activar_ventana(F._buscar_ventana_siape())
        F._jab_click_bounds(info)
        time.sleep(1.5)
    _el, info = _celda_codigo(fr, codigo)
    if not info or "enfocado" not in (info.get("states") or []):
        raise RuntimeError(f"No pude dejar seleccionada la fila {codigo}; no toco Certificado.")


def _tipo_en_pdf(txt):
    m = re.search(r"Tipo Examen:\s*(.+?)\s+Organismo", txt)
    return EM_norm(m.group(1)) if m else ""


def EM_norm(s):
    return " ".join(str(s or "").upper().replace("Í", "I").replace("Ó", "O").split())


def bajar_certificado(fr, fila, dni):
    """Selecciona la fila, toca Certificado y devuelve (pdf en Descargas, texto) verificado
    contra el DNI y el TIPO de examen de la fila."""
    seleccionar_fila(fr, fila.get("CODIGO"))
    antes = _pdfs_descargas()
    t0 = time.time()
    F._jab_click_element(fila["_btn"])
    time.sleep(3)
    aviso, _ = F.leer_dialogo_jab(max_segundos=6)
    if aviso:
        cerrar_modales()
        raise RuntimeError(f"SIAPE: {aviso[:200]}")
    pdf = esperar_pdf_nuevo(antes, t0)
    if not pdf:
        raise RuntimeError(f"No aparecio el PDF en {DESCARGAS} a los {ESPERA_PDF}s de tocar Certificado.")
    txt = re.sub(r"\s+", " ", texto_pdf(pdf))
    if "APTITUD PSICOF" not in txt.upper() or not re.search(rf"\b{dni}\b", txt):
        # no lo borro: queda en Descargas para mirarlo
        raise RuntimeError(f"El PDF bajado ({pdf.name}) no es el certificado de {dni}; lo dejo en Descargas.")
    tipo_pdf, tipo_fila = _tipo_en_pdf(txt), EM_norm(fila.get("TIPO DE EXAMEN"))
    if tipo_pdf != tipo_fila:
        raise RuntimeError(f"El PDF bajado ({pdf.name}) es de '{tipo_pdf or '?'}' y la fila {fila.get('CODIGO')} "
                           f"es '{tipo_fila}': SIAPE devolvio otra fila; lo dejo en Descargas.")
    return pdf, txt


def guardar_en_docu(pdf, fila, dni):
    destino_dir = carpeta_destino(dni)
    destino_dir.mkdir(parents=True, exist_ok=True)
    destino = destino_dir / f"Apto Psicofisico SIAPE {fila.get('CODIGO') or dni}.pdf"
    shutil.move(str(pdf), str(destino))
    MN.auditar_docu(SCRIPT_ID, dni, destino, detalle=f"fila {fila.get('CODIGO')} {fila.get('TIPO DE EXAMEN') or ''}".strip())
    return destino


def guardar_grilla(filas, r):
    """Lo que se ve en la grilla va a examenes_medicos_siape (origen 'pantalla'): ahi aparecen
    examenes sin FECHA que la exportacion por periodo no trae. Nunca corta al robot."""
    datos = [{
        "codigo_examen": f.get("CODIGO"), "dni": int(r["dni"]),
        "apellido": r.get("apellido") or f.get("APELLIDO Y NOMBRE") or None,
        "nombre": r.get("nombre") if r.get("apellido") else None,
        "organismo": f.get("ORGANISMO") or None, "tipo_examen": f.get("TIPO DE EXAMEN") or None,
        "modalidad": f.get("MODALIDAD") or None, "fecha": EM._fecha(f.get("FECHA")),
        "estado_examen": f.get("ESTADO") or None, "resolucion": f.get("RESULTADO") or None,
        "tipo_tramite": f.get("TRAMITE") or None,
    } for f in filas if f.get("CODIGO")]
    try:
        EM.guardar(datos, "pantalla")
    except Exception as e:
        log(f"   AVISO: no pude guardar la grilla en examenes_medicos_siape: {e}")


def procesar(fr, r, dry_run=False):
    """r['solo_fecha']: la carpeta ya tiene el certificado; solo interesa la fecha del examen.
    r['objetivo']: codigo del apto nuevo que hay que bajar (ya tenia uno de SIAPE)."""
    dni = r["dni"]
    contador, filas = consultar(fr, dni)
    if not filas and r.get("objetivo"):
        # la tabla dice que hay un apto nuevo: un "0" es sospechoso, se consulta otra vez
        log(f"   AVISO: la grilla vino vacia pero se esperaba {r['objetivo']}; consulto de nuevo.")
        time.sleep(3)
        contador, filas = consultar(fr, dni)
    guardar_grilla(filas, r)
    if not filas:
        return "sin_examen", "SIAPE no tiene examenes medicos para este DNI"
    if r.get("objetivo"):
        fila = next((f for f in filas if f.get("CODIGO") == r["objetivo"] and f.get("_btn_ok")
                     and (f.get("RESULTADO") or "").upper().startswith("APTO")), None)
        if not fila:
            return "sin_apto", f"El apto nuevo {r['objetivo']} no aparece en la grilla: {resumen(filas)}"
    else:
        fila = elegir_fila(filas)
    if not fila:
        return "sin_apto", f"Sin examen APTO con certificado: {resumen(filas)}"
    det = f"{fila.get('CODIGO')} {fila.get('TIPO DE EXAMEN')} {fila.get('RESULTADO')}"
    sin_fecha = not EM._fecha(fila.get("FECHA"))
    if r.get("solo_fecha") and not sin_fecha:
        return "ya_estaba", f"{det}: la carpeta ya tiene archivo y SIAPE trae la fecha ({fila.get('FECHA')})"
    if dry_run:
        return "dry_run", f"Bajaria {det}" + (" (sin FECHA en SIAPE: tomaria la del certificado)" if sin_fecha else "")
    pdf, txt = bajar_certificado(fr, fila, dni)
    nota = ""
    if sin_fecha:
        f_cert = EM.fecha_de_certificado(txt)
        if not f_cert:
            nota = " | SIAPE sin FECHA y no pude leer la fecha del certificado"
        elif EM.cargar_fecha_certificado(fila.get("CODIGO"), f_cert):
            nota = f" | SIAPE sin FECHA: cargue {f_cert:%d/%m/%Y} (fecha del certificado)"
    if r.get("solo_fecha"):
        pdf.unlink()   # lo bajo el robot y la carpeta ya tiene su certificado: no lo duplico
        return "ok", f"{det}{nota or ' | sin cambios de fecha'}"
    destino = guardar_en_docu(pdf, fila, dni)
    EM.marcar_certificado(fila.get("CODIGO"), destino)
    return "ok", f"{det} -> {destino}{nota}"


# ───────────────────────── main ─────────────────────────

def main():
    ap = argparse.ArgumentParser()
    # CERT_TANDA: la pone la exportacion 123 cuando la lanzo el boton "Bajar de SIAPE" de una tanda
    ap.add_argument("--tanda", default=(os.environ.get("CERT_TANDA") or "").strip() or None)
    ap.add_argument("--dni")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--forzar", action="store_true", help="baja aunque la subcarpeta ya tenga archivos")
    ap.add_argument("--dry-run", action="store_true", help="busca en SIAPE pero NO baja")
    ap.add_argument("--solo-lista", action="store_true", help="lista los agentes, sin tocar SIAPE")
    args = ap.parse_args()

    cn = F.conn()
    todos = traer_agentes(cn, tanda=args.tanda, solo_dni=args.dni)
    con_fecha = aptos_con_fecha(cn)
    aptos = aptos_por_dni(cn)
    sin_ingreso = sin_ingreso_conocido(cn)
    cn.close()
    pend, saltados = [], []
    for r in todos:
        nuevo = apto_nuevo_sin_bajar(aptos.get(int(r["dni"]), []))
        if nuevo:
            pend.append({**r, "objetivo": nuevo["codigo_examen"],
                         "objetivo_txt": f"{nuevo['codigo_examen']} {nuevo['tipo_examen']} {nuevo['fecha']:%d/%m/%Y}"})
        elif int(r["dni"]) in sin_ingreso and not args.dni:
            saltados.append(r)
        elif not ya_tiene(r["dni"]) or args.forzar:
            pend.append(r)
        elif int(r["dni"]) not in con_fecha:
            # tiene el certificado en la carpeta pero no un apto fechado en la tabla:
            # se mira SIAPE para completar la fecha (sin volver a guardar el PDF)
            pend.append({**r, "solo_fecha": True})
        else:
            saltados.append(r)
    if args.limit:
        pend = pend[:args.limit]
    log(f"Agentes en tandas: {len(todos)}; ya completos: {len(saltados)}; para procesar: {len(pend)} "
        f"({sum(1 for r in pend if r.get('objetivo'))} con apto nuevo, "
        f"{sum(1 for r in pend if r.get('solo_fecha'))} solo para la fecha)")
    if args.solo_lista:
        for r in pend:
            extra = (f"  (apto nuevo {r['objetivo_txt']})" if r.get("objetivo")
                     else "  (solo fecha)" if r.get("solo_fecha") else "")
            log(f"  {r['dni']}  {nombre_ag(r)}  [{r.get('tanda') or '-'}]{extra}")
        return 0
    # sin nada que bajar no abre SIAPE ni ensucia la pagina Robots con 60 avisos "ya estaba"
    if not pend:
        return 0

    F.pyautogui.FAILSAFE = F.SIAPE_PYAUTOGUI_FAILSAFE
    F.asegurar_sesion()
    cerrar_modales()
    fr = abrir_pantalla()

    errores = bajados = 0
    for r in pend:
        log(f"-> {r['dni']} {nombre_ag(r)}" + (" [DRY-RUN]" if args.dry_run else ""))
        try:
            estado, motivo = procesar(fr, r, dry_run=args.dry_run)
        except Exception as e:
            estado, motivo = "error", str(e)[:400]
            cerrar_modales()
            try:
                fr = abrir_pantalla()
            except Exception as e2:
                log(f"   ERROR: {motivo}")
                log(f"   No pude volver a Examenes Médicos ({e2}); freno la corrida.")
                MN.registrar_item(SCRIPT_ID, r["dni"], nombre_ag(r), "Apto psicofisico", None, None, "error", motivo)
                errores += 1
                break
        log(f"   {estado}: {motivo}")
        MN.registrar_item(SCRIPT_ID, r["dni"], nombre_ag(r), "Apto psicofisico", None, None,
                          {"ok": "ok", "error": "error"}.get(estado, "aviso"), f"{estado}: {motivo}")
        errores += estado == "error"
        bajados += estado == "ok"
    log(f"Listo: {len(pend)} procesado(s), {bajados} bajado(s), {errores} con error.")
    return 1 if errores else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log("Cancelado.")
        sys.exit(130)
