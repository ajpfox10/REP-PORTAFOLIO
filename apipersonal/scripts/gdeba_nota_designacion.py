"""
Robot: carga en GDEBA (GEDO) las notas de designación de una tanda y las envía a firmar.

Lee de `tramites_nota_designacion` las notas GENERADA / ERROR de la tanda pedida
(las arma Trámites → tanda → 🏛️ Nota GDEBA) y por cada una:
  Inicio de Documento → IF → Producirlo yo mismo → Referencia
  "DESIGNACION PLANTA PERMANENTE <APELLIDO NOMBRE>" → texto de la nota →
  firmante VSFERNANDEZV (Valeria Silvina Fernandez Viña) → Enviar a Firmar → Aceptar.
OK → estado ENVIADA_FIRMA (+ enviada_at) · falla → estado ERROR + gdeba_error (sigue con la próxima).

LOGIN (como el robot del Ministerio): sesión guardada o CONTRASEÑA GUARDADA en el Chrome
del perfil (opcional: GDEBA_USER / GDEBA_PASS del .env). Si GDEBA pide
captcha, espera (hasta 15 min) a que la persona lo complete: no se resuelve solo.

MODO PRUEBA (por defecto si el pedido no dice lo contrario): hace UNA nota, abre
"Enviar a Firmar", elige el firmante y frena ANTES de Aceptar; deja la ventana abierta para revisar y guarda
captura + campos en logs/gdeba/. No cambia el estado de la nota.

Parámetros: los deja la app en app_runtime_config 'gdeba_nota_designacion_pedido'
({tanda, prueba, dnis?, firmanteUsuario?}); por línea de comando se
pueden pisar:  python gdeba_nota_designacion.py --tanda "TANDA 1" [--real] [--dni N ...]
Se corre con run_robot.py gdeba_nota_designacion (turno propio: robots_gdeba).
"""
import argparse
import html
import json
import re
import os
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN  # conn() + registrar_run() + registrar_item() + .env

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

SCRIPT_ID = "gdeba_nota_designacion"
DESCRIPCION = "Notas de designación → GDEBA (enviar a firmar)"
PERFIL = os.environ.get("GDEBA_CHROME_PROFILE", r"D:\G\comparacion\gdeba_chrome_profile")
URL_LOGIN = "https://cas.gdeba.gba.gob.ar/acceso/login/"
URL_ESCRITORIO = "https://eu.gdeba.gba.gob.ar/eu-web/"
URL_GEDO = "https://eug.gdeba.gba.gob.ar/gedo-web/"
SECTOR_REPARTICION = "DPTRH"
TIPO_DOC = "IF"
FIRMANTE_USUARIO_DEF = "VSFERNANDEZV"   # Valeria Silvina Fernandez Viña (HPDIGAMSALGP)
ESPERA_LOGIN_SEG = 15 * 60
ESPERA_PRUEBA_SEG = 30 * 60
LOG_DIR = Path(__file__).resolve().parent / "logs" / "gdeba"
CLAVE_PEDIDO = "gdeba_nota_designacion_pedido"  # sync-guard:ignore


try:  # una consola cp1252 no tumba al robot por un ▶ o una ñ
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass


def log(msg):
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())


# ── pedido + base ────────────────────────────────────────────────────────────

def leer_pedido(args):
    ped = {}
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            cur.execute("SELECT config_json FROM app_runtime_config WHERE config_key = %s", (CLAVE_PEDIDO,))
            r = cur.fetchone()
            if r and r.get("config_json"):
                ped = r["config_json"] if isinstance(r["config_json"], dict) else json.loads(r["config_json"])
    except Exception as e:
        log(f"AVISO: no pude leer el pedido de la app: {e}")
    if args.tanda:
        ped["tanda"] = args.tanda
    if args.real:
        ped["prueba"] = False
    if args.dni:
        ped["dnis"] = args.dni
    ped.setdefault("prueba", True)
    ped.setdefault("firmanteUsuario", FIRMANTE_USUARIO_DEF)
    return ped


def notas_pendientes(tanda, dnis, limite):
    sql = ("SELECT id, dni, apellido_nombre, texto FROM tramites_nota_designacion "
           "WHERE tanda = %s AND estado IN ('GENERADA','ERROR')")
    params = [tanda]
    if dnis:
        sql += " AND dni IN (" + ",".join(["%s"] * len(dnis)) + ")"
        params += [int(d) for d in dnis]
    sql += " ORDER BY apellido_nombre"
    if limite:
        sql += f" LIMIT {int(limite)}"
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def marcar(nota_id, estado, error=None):
    with MN.conn() as cn, cn.cursor() as cur:
        cur.execute("UPDATE tramites_nota_designacion SET estado = %s, gdeba_error = %s, estado_at = NOW(), "
                    "estado_por = NULL, enviada_at = IF(%s = 'ENVIADA_FIRMA', NOW(), enviada_at) WHERE id = %s",
                    (estado, (error or None) and str(error)[:500], estado, nota_id))
        cn.commit()


# OJO: en la API sync de Playwright NO usar time.sleep: congela los eventos y page.url
# queda viejo (el robot no veía que ya habían iniciado sesión). Usar page.wait_for_timeout.

# ── helpers de pantalla (GDEBA es ZK: los id cambian en cada sesión) ─────────

def evidencia(page, tag):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    base = LOG_DIR / f"{datetime.now():%Y%m%d_%H%M%S}_{tag}"
    try:
        page.screenshot(path=f"{base}.png", full_page=True)
        campos = page.evaluate("""() => [...document.querySelectorAll('input,textarea,button,iframe,.z-label,.z-window-header,.z-window-highlighted-header,.z-messagebox')]
          .filter(e => e.offsetParent !== null)
          .map(e => ({t: e.tagName, id: e.id, type: e.type || '', title: e.title || '',
                      txt: (e.innerText || e.value || e.placeholder || '').trim().slice(0, 100)}))""")
        (Path(f"{base}.json")).write_text(json.dumps(campos, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception as e:
        log(f"AVISO: no pude guardar evidencia {tag}: {e}")
    return f"{base}.png"


def mensaje_error_zk(page):
    """Texto de un cartel de error/aviso de ZK visible, si hay."""
    try:
        box = page.locator(".z-messagebox-window:visible, .z-messagebox:visible").first
        if box.count():
            return box.inner_text(timeout=1500).strip()
    except Exception:
        pass
    return None


def campo_de(page, etiqueta, scope=None):
    """Input/textarea que sigue a la etiqueta visible `etiqueta`."""
    # con scope (una ventana ZK) la búsqueda es relativa: si no, agarra etiquetas
    # de la tabla de tareas que está detrás (pasó con "Referencia").
    base = scope or page
    raiz = ".//" if scope is not None else "//"
    # el primero VISIBLE: ZK deja textareas ocultos e inputs como #inputMotivo entre la
    # etiqueta y el campo real (visto 11/11 en "Producir documento").
    xp = (f"xpath=({raiz}*[not(self::script)][starts-with(normalize-space(text()), '{etiqueta}')])[1]"
          f"/following::*[self::input[not(@type='checkbox') and not(@type='hidden') and not(@type='file')] or self::textarea]")
    loc = base.locator(xp)
    for i in range(min(loc.count(), 15)):
        if loc.nth(i).is_visible():
            return loc.nth(i)
    return None


def boton(page, texto):
    """Botón ZK por su texto (puede venir partido en dos líneas)."""
    loc = page.get_by_role("button", name=texto)
    if loc.count():
        return loc.first
    return page.locator(f"button:has-text('{texto.split()[0]}')").filter(has_text=texto.split()[-1]).first


# ── flujo ────────────────────────────────────────────────────────────────────

def _adentro(page):
    # por host y ruta: la URL del login trae ?service=...eu-web en los parámetros
    from urllib.parse import urlparse
    u = urlparse(page.url)
    return u.hostname not in (None, "cas.gdeba.gba.gob.ar") and (
        u.path.startswith("/eu-web") or u.path.startswith("/gedo-web"))


def _esperar_adentro(page, seg):
    fin = time.time() + seg
    while time.time() < fin:
        if _adentro(page):
            return True
        page.wait_for_timeout(1000)
    return False


def esperar_login(page):
    """Entra solo, como el robot del Ministerio:
    1) sesión guardada en el perfil → va directo al Escritorio Único, sin login;
    2) sesión vencida → contraseña GUARDADA EN CHROME (perfil del robot) + Acceder;
       opcional: si el .env tiene GDEBA_USER / GDEBA_PASS se usan esos en su lugar;
    3) si no puede (clave cambiada, captcha) → espera a que la persona entre en la
       ventana. El captcha no se resuelve ni se saltea."""
    page.goto(URL_ESCRITORIO, wait_until="domcontentloaded")
    if _esperar_adentro(page, 15):
        log(f"Sesión guardada: adentro sin login ({page.url.split('?')[0]}).")
        page.wait_for_timeout(2000)
        return True

    usuario = os.environ.get("GDEBA_USER", "").strip()
    clave = os.environ.get("GDEBA_PASS", "")
    if not (usuario and clave):
        # Contraseña guardada en el Chrome del perfil (lo que usa hoy, pedido 11/11): Chrome
        # autocompleta usuario y clave; el robot hace foco y aprieta Acceder. La clave nunca
        # pasa por el script (Chrome no la deja leer por JS hasta que se envía el form).
        try:
            u = page.get_by_role("textbox", name="Usuario/Cuil/Cuit")
            u.wait_for(timeout=15000)
            for _ in range(10):
                page.wait_for_timeout(700)
                if u.input_value().strip():
                    break
            if u.input_value().strip():
                u.click()
                page.get_by_role("textbox", name="Contraseña").click()
                page.wait_for_timeout(500)
                page.get_by_role("button", name="Acceder").click(timeout=5000)
                log("Sesión vencida: ingresé con la contraseña guardada en Chrome.")
                if _esperar_adentro(page, 25):
                    log(f"Sesión iniciada ({page.url.split('?')[0]}).")
                    page.wait_for_timeout(2000)
                    return True
                log(">>> No pude entrar con la contraseña guardada (¿cambió la clave o pide verificación?). "
                    "Iniciá sesión en la ventana de Chrome. Espero hasta 15 min.")
            else:
                log(">>> Chrome no autocompletó el usuario de GDEBA: iniciá sesión en la ventana. Espero hasta 15 min.")
        except PWTimeout:
            log("AVISO: no encontré los campos del login de GDEBA.")
    else:
        try:
            page.get_by_role("textbox", name="Usuario/Cuil/Cuit").fill(usuario, timeout=15000)
            page.get_by_role("textbox", name="Contraseña").fill(clave, timeout=5000)
            page.get_by_role("button", name="Acceder").click(timeout=5000)
            log("Sesión vencida: ingresé con el usuario del .env.")
            if _esperar_adentro(page, 25):
                log(f"Sesión iniciada ({page.url.split('?')[0]}).")
                page.wait_for_timeout(2000)
                return True
            log(">>> GDEBA pide verificación (captcha): completala en la ventana de Chrome. Espero hasta 15 min.")
        except PWTimeout:
            log("AVISO: no encontré los campos del login de GDEBA.")

    if _esperar_adentro(page, ESPERA_LOGIN_SEG):
        log(f"Sesión iniciada ({page.url.split('?')[0]}).")
        page.wait_for_timeout(2000)
        return True
    return False


def elegir_reparticion(page):
    try:
        page.get_by_text("Seleccion de repartición").or_(page.get_by_text("Selección de repartición")).first.wait_for(timeout=8000)
    except PWTimeout:
        log("No apareció la selección de repartición (ya estaba elegida).")
        return
    fila = page.get_by_role("row").filter(has=page.get_by_role("cell", name=SECTOR_REPARTICION, exact=True)).first
    fila.click()
    log(f"Repartición: sector {SECTOR_REPARTICION}.")
    try:
        page.get_by_role("button", name="OK").click(timeout=8000)
    except PWTimeout:
        pass
    page.wait_for_timeout(2000)


def _pagina_gedo(ctx):
    for pg in ctx.pages:
        if "gedo-web" in pg.url:
            return pg
    return None


def entrar_gedo(page):
    """Devuelve la página de GEDO (puede abrirse en otra pestaña)."""
    ctx = page.context
    if "gedo-web" not in page.url:
        try:
            fila = page.get_by_role("row").filter(has=page.get_by_role("cell", name="GEDO", exact=True)).first
            fila.get_by_role("button").first.click(timeout=10000)
        except PWTimeout:
            log("No encontré el ▶ de GEDO.")
        for _ in range(20):
            page.wait_for_timeout(1000)
            if _pagina_gedo(ctx):
                break
        g = _pagina_gedo(ctx)
        if g is None:
            log("GEDO no se abrió con el ▶: voy directo a la dirección de GEDO.")
            page.goto(URL_GEDO, wait_until="domcontentloaded")
            g = page
        elif g is not page:
            log("GEDO se abrió en otra pestaña: sigo en esa.")
            g.bring_to_front()
        page = g
    page.set_default_timeout(30000)
    page.get_by_role("button", name="Inicio de Documento").wait_for(timeout=60000)
    log(f"Dentro de GEDO ({page.url.split('?')[0]}).")
    return page


def cargar_texto(page, texto):
    frame = page.frame_locator("iframe.cke_wysiwyg_frame, iframe[title^='Editor de texto enriquecido']").first
    body = frame.locator("body")
    body.wait_for(timeout=20000)
    # sin párrafos vacíos: el editor ya deja espacio entre párrafos (visto 11/11)
    parrafos = "".join(f"<p>{html.escape(l)}</p>" for l in texto.split("\n") if l.strip())
    body.click()
    body.evaluate("(b, h) => { b.innerHTML = h; }", parrafos)
    # tecleo mínimo para que el editor avise el cambio al servidor (ZK sincroniza por eventos)
    body.press("Control+End")
    body.type(" ")
    body.press("Backspace")


def elegir_firmante(page, usuario):
    """Ventana "Enviar a Firmar" → combobox "Usuario firmante": escribe el USUARIO GDEBA
    exacto y elige la opción "Nombre ( USUARIO - REPARTICION )" de ese usuario.
    Por nombre no: con VSFER salen 3 personas y hay otra Valeria Fernandez (VSFERNANDEZ1).
    Devuelve la ventana para confirmar con Aceptar."""
    win = page.locator(".z-window").filter(has_text="Usuario firmante").last
    win.wait_for(timeout=20000)
    inp = win.locator("input.z-combobox-input").first
    inp.click()
    inp.fill("")
    inp.press_sequentially(usuario, delay=100)
    patron = re.compile(r"\(\s*" + re.escape(usuario) + r"\s*-", re.I)
    opciones = page.locator(".z-combobox-popup:visible .z-comboitem")
    for _ in range(10):
        page.wait_for_timeout(800)
        for k in range(opciones.count()):
            t = opciones.nth(k).inner_text().replace(" ", " ")
            if patron.search(t):
                opciones.nth(k).click()
                page.wait_for_timeout(1000)
                elegido = inp.input_value().replace(" ", " ")
                if not patron.search(elegido):
                    raise RuntimeError(f"El combobox quedó con '{elegido}' en vez de {usuario}")
                log(f"Firmante elegido: {' '.join(elegido.split())}.")
                return win
    vistos = [" ".join(opciones.nth(k).inner_text().split()) for k in range(min(opciones.count(), 8))]
    raise RuntimeError(f"El usuario firmante {usuario} no aparece en la lista (vi: {vistos or 'nada'})")


def una_nota(page, nota, ped):
    dni, nombre = nota["dni"], nota["apellido_nombre"]
    referencia = f"DESIGNACION PLANTA PERMANENTE {nombre}"[:250]

    page.get_by_role("button", name="Inicio de Documento").click()
    ventana = page.locator(".z-window").filter(has_text="Iniciar Producción de Documento").first
    ventana.wait_for(timeout=20000)
    tipo = ventana.get_by_role("row").filter(has_text="Documento Electrónico").get_by_role("textbox").first
    tipo.click()
    tipo.fill(TIPO_DOC)
    tipo.press("Tab")
    page.wait_for_timeout(2500)
    if not norm(ventana.inner_text()).count("INFORME") and not norm(ventana.inner_text()).count(" IF"):
        log("AVISO: no veo la descripción del tipo IF; sigo igual.")
    boton(ventana, "Producirlo yo mismo").click()

    prod = page.locator(".z-window").filter(has_text="Producir documento").last
    prod.wait_for(timeout=30000)
    ref = None
    for _ in range(20):
        ref = campo_de(page, "Referencia", scope=prod)
        if ref is not None and ref.is_visible():
            break
        page.wait_for_timeout(1000)
    if ref is None:
        raise RuntimeError("No apareció el campo Referencia en 'Producir documento'")
    try:
        ref.fill(referencia, timeout=10000)
    except PWTimeout:
        ref.click(force=True, timeout=5000)
        ref.press_sequentially(referencia, delay=20)
    cargar_texto(page, nota["texto"])
    log("Referencia y texto cargados.")

    # Firmante (visto 11/11): el botón "Enviar a Firmar" de la izquierda abre la ventana
    # "Enviar a Firmar" con el combobox "Usuario firmante" y Aceptar/Cancelar. Abrir esa
    # ventana NO envía nada; lo que envía es Aceptar.
    prod.get_by_role("button", name="Enviar a Firmar").click()
    win = elegir_firmante(page, ped["firmanteUsuario"])

    if ped["prueba"]:
        log("MODO PRUEBA: firmante elegido, NO apreto Aceptar.")
        return "prueba"

    win.get_by_role("button", name="Aceptar").click()
    page.wait_for_timeout(3000)
    err = mensaje_error_zk(page)
    if err and any(w in err.lower() for w in ("error", "debe", "obligatori", "inválid", "invalid", "no se pudo")):
        raise RuntimeError(f"GDEBA: {err}")
    # confirmaciones de ZK ("se envió la tarea...") → OK
    for t in ("OK", "Aceptar"):
        bt = page.get_by_role("button", name=t)
        if bt.count() and bt.first.is_visible():
            bt.first.click()
            break
    page.get_by_role("button", name="Inicio de Documento").wait_for(timeout=60000)
    if page.locator(".z-window").filter(has_text="Producir documento").count() and             page.locator(".z-window").filter(has_text="Producir documento").last.is_visible():
        raise RuntimeError("Después de Aceptar sigue abierta 'Producir documento': no sé si se envió")
    return "enviada"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tanda")
    ap.add_argument("--real", action="store_true", help="envía a firmar (sin esto: modo prueba)")
    ap.add_argument("--dni", type=int, nargs="*")
    args = ap.parse_args()
    ped = leer_pedido(args)
    t0 = time.time()

    if not ped.get("tanda"):
        MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo="Falta la tanda (lanzarlo desde Trámites → Nota GDEBA)")
        return 2
    notas = notas_pendientes(ped["tanda"], ped.get("dnis"), 1 if ped["prueba"] else None)
    modo = "PRUEBA (1 nota, sin enviar)" if ped["prueba"] else "REAL (envía a firmar)"
    log(f"Tanda {ped['tanda']} · {len(notas)} nota(s) pendientes · modo {modo}")
    if not notas:
        MN.registrar_run(SCRIPT_ID, DESCRIPCION, "ok", motivo="No hay notas pendientes en la tanda", filas=0)
        return 0

    enviadas, errores = 0, 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PERFIL, channel="chrome", headless=False, slow_mo=120,
            viewport={"width": 1400, "height": 900},
            args=["--disable-blink-features=AutomationControlled"]
                 + (["--remote-debugging-port=9333"] if ped["prueba"] else []),
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_default_timeout(30000)
        try:
            if not esperar_login(page):
                MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo="Nadie inició sesión en GDEBA en 15 min",
                                 duracion_seg=int(time.time() - t0))
                return 3
            try:
                elegir_reparticion(page)
                page = entrar_gedo(page)
            except Exception as e:
                msg = str(e).split("\n")[0][:400]
                png = evidencia(page, "error_entrada")
                log(f"ERROR entrando a GEDO: {msg} (captura {png})")
                MN.registrar_run(SCRIPT_ID, DESCRIPCION, "error", motivo=f"No pude entrar a GEDO: {msg}",
                                 duracion_seg=int(time.time() - t0))
                return 4

            for n in notas:
                log(f"── {n['apellido_nombre']} (DNI {n['dni']})")
                try:
                    r = una_nota(page, n, ped)
                    if r == "prueba":
                        png = evidencia(page, f"prueba_{n['dni']}")
                        log(f"MODO PRUEBA: frené antes de enviar. Captura: {png}")
                        log(">>> Revisá la ventana. Cuando termines, CERRALA (o cancelá el documento en GDEBA). No se envió nada.")
                        MN.registrar_item(SCRIPT_ID, dni=n["dni"], nombre=n["apellido_nombre"], estado="aviso",
                                          detalle="Prueba: cargada sin enviar a firmar")
                        try:
                            page.wait_for_event("close", timeout=ESPERA_PRUEBA_SEG * 1000)
                        except Exception:
                            pass
                        break
                    marcar(n["id"], "ENVIADA_FIRMA")
                    enviadas += 1
                    evidencia(page, f"ok_{n['dni']}")
                    MN.registrar_item(SCRIPT_ID, dni=n["dni"], nombre=n["apellido_nombre"], estado="ok",
                                      detalle="Enviada a firmar")
                except Exception as e:
                    errores += 1
                    msg = str(e).split("\n")[0][:480]
                    png = evidencia(page, f"error_{n['dni']}")
                    log(f"ERROR: {msg} (captura {png})")
                    log("DETALLE: " + " | ".join(x.strip() for x in str(e).splitlines()[1:8] if x.strip()))
                    marcar(n["id"], "ERROR", msg)
                    MN.registrar_item(SCRIPT_ID, dni=n["dni"], nombre=n["apellido_nombre"], estado="error", detalle=msg)
                    if ped["prueba"]:
                        # en prueba NO se cancela ni se reintenta (cada intento deja una tarea en GEDO):
                        # queda abierta para inspeccionarla (CDP :9333) hasta que la cierren.
                        log(">>> PRUEBA con error: dejo la ventana abierta para revisar. Cerrala cuando termines.")
                        try:
                            page.wait_for_event("close", timeout=ESPERA_PRUEBA_SEG * 1000)
                        except Exception:
                            pass
                        break
                    # vuelve a la bandeja para seguir con la próxima
                    try:
                        for t in ("OK", "Cancelar", "Cerrar"):
                            b = page.get_by_role("button", name=t)
                            if b.count() and b.first.is_visible():
                                b.first.click()
                        page.goto(URL_GEDO, wait_until="domcontentloaded")
                        page.get_by_role("button", name="Inicio de Documento").wait_for(timeout=60000)
                    except Exception:
                        log("No pude volver a la bandeja de GEDO: corto acá.")
                        break
        finally:
            try:
                ctx.close()
            except Exception:
                pass

    estado = "error" if errores else "ok"
    motivo = (("Prueba: falló la carga (ver capturas en logs/gdeba)" if errores else "Prueba: 1 nota cargada sin enviar")
              if ped["prueba"]
              else f"{enviadas} enviada(s) a firmar, {errores} con error")
    MN.registrar_run(SCRIPT_ID, DESCRIPCION, estado, motivo=motivo, filas=enviadas, duracion_seg=int(time.time() - t0))
    log(motivo)
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
