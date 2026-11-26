# Robot: confirma TODOS los usuarios pendientes de Gestiones Personales (Intranet del Ministerio).
# Circuito grabado el 12/11/2026 (logs/grabaciones/reset_claves_20261112_163321):
#   Intranet -> Administrador de Gestiones Personales -> /usuario/ (lista "A CONFIRMAR")
#   -> por cada uno "Ver Pendiente" (busca por legajo) -> "- Seleccione -" -> "Confirmar usuario"
#   -> modal "Confirmar". Por dentro va a /usuario/{id}/reset y el estado queda
#   "DEBE INGRESAR CON LA CLAVE PROVISORIA (DOCUMENTO)".
#
# Por defecto SIMULA (lista y no confirma). Para confirmar de verdad: --confirmar
# Login: usuario INTRANET_GP_USER (o INTRANET_USER) y clave INTRANET_GP_PASS (o INTRANET_PASS).
# Sin clave, deja la ventana en el login para que la persona entre a mano y sigue solo.
#
# Uso: python confirmar_usuarios_gp.py [--confirmar] [--headless] [--max N]
import os, sys, json, argparse, re, time
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

def _cargar_env():
    """Mismo login que los robots de carga de Intranet: INTRANET_USER/INTRANET_PASS del .env del api
    (cuando lo lanza el server ya vienen en el entorno; corrido a mano los lee de acá)."""
    envf = Path(__file__).resolve().parent.parent / ".env"
    if not envf.exists():
        return
    for line in envf.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.match(r"\s*(INTRANET_[A-Z_]+)\s*=\s*(.*)\s*$", line)
        if m and not os.environ.get(m.group(1)):
            os.environ[m.group(1)] = m.group(2).strip().strip('"').strip("'")
_cargar_env()

BASE       = "https://sistemas.ms.gba.gov.ar"
URL_LOGIN  = BASE + "/intranet/login"
URL_USUARIOS = BASE + "/gestionesperintranet/web/app.php/usuario/"
USUARIO    = os.environ.get("INTRANET_GP_USER") or os.environ.get("INTRANET_USER", "xxxxxxx")
CLAVE      = os.environ.get("INTRANET_GP_PASS")  # opcional: si no está, usa la clave guardada en el perfil
# mismo perfil de Chrome que el robot de carga de licencias (tiene la sesión / clave guardada)
PERFIL     = os.environ.get("INTRANET_GP_PROFILE") or os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")
EST_PEND   = "A CONFIRMAR"
EST_OK     = "CLAVE PROVISORIA"

LOGDIR = Path(__file__).resolve().parent.parent / "logs" / "confirmar_usuarios_gp"
LOGDIR.mkdir(parents=True, exist_ok=True)
LOG = LOGDIR / f"{datetime.now():%Y%m%d_%H%M%S}.jsonl"

def log(**ev):
    ev["t"] = datetime.now().strftime("%H:%M:%S")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(json.dumps(ev, ensure_ascii=False), flush=True)

def cerrar_aviso(page):
    """El login muestra un modal de aviso con botón 'Cerrar'."""
    try:
        b = page.locator(".modal.in button:has-text('Cerrar'), .modal.show button:has-text('Cerrar')").first
        if b.count() and b.is_visible():
            b.click(); page.wait_for_timeout(500)
    except Exception:
        pass

def cerrar_sesion(page):
    for url in (BASE + "/gestionesperintranet/web/app.php/logout", BASE + "/intranet/logout"):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000); page.wait_for_timeout(1000)
        except Exception:
            pass

def ir(page, url, intentos=3):
    """goto con reintentos: la Intranet a veces tarda en responder."""
    for i in range(intentos):
        try:
            return page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            if i == intentos - 1:
                raise
            print(f"  la Intranet no respondió ({str(e).splitlines()[0][:80]}), reintento {i + 2}/{intentos}", flush=True)
            page.wait_for_timeout(10000)

def login(page):
    ir(page, URL_LOGIN)
    if page.locator("#username").count() == 0:
        print("Sesión ya activa.")
        return
    cerrar_aviso(page)
    if CLAVE:
        page.fill("#username", USUARIO)
        page.fill("#password", CLAVE)
        page.click("form button[type=submit]")
    else:
        # Chrome autocompleta la clave guardada en el perfil: si quedó cargada, solo apretar Iniciar sesión
        # OJO: Chrome no le muestra al script la clave autocompletada hasta que hay un clic en la página
        # (input_value da "" aunque se vean los puntitos) → clic en el usuario primero y recién ahí leer.
        autocompleto = False
        for _ in range(3):
            page.wait_for_timeout(2500)
            try:
                page.click("#username")
                page.wait_for_timeout(500)
                if page.input_value("#username") and page.input_value("#password"):
                    page.click("form button[type=submit]")
                    print("Login con la clave guardada en el perfil.", flush=True)
                    autocompleto = True
                    break
            except Exception:
                pass
        if not autocompleto:
            print("Chrome no autocompletó la clave: iniciá sesión a mano en la ventana. Espero hasta 5 minutos.", flush=True)
    # 'commit': no esperar el load (si la persona sigue navegando a mano, no se pierde el evento)
    deadline = time.time() + 300
    ultimo = 0
    while time.time() < deadline:
        for pg in page.context.pages:
            if re.search(r"/intranet/(sistemas|welcome)|/gestionesperintranet/", pg.url):
                if pg is not page:
                    page.goto(pg.url, wait_until="domcontentloaded", timeout=60000)
                return
        if time.time() - ultimo > 15:
            print("  esperando login... pestañas:", [pg.url for pg in page.context.pages], flush=True)
            ultimo = time.time()
        page.wait_for_timeout(1000)
    raise Exception("No se inició sesión en 5 minutos.")

def entrar_gp(page):
    """Entra por el link del menú (arma la sesión de la aplicación) y va a la lista."""
    if "/gestionesperintranet/" in page.url:
        page.goto(URL_USUARIOS, wait_until="domcontentloaded", timeout=60000)
        if page.locator("#search_form").count():
            return
    if "/intranet/sistemas" not in page.url:
        page.goto(BASE + "/intranet/sistemas/", wait_until="domcontentloaded", timeout=60000)
    # El menú es un link a /intranet/sistemas/select/<hash> que redirige al sistema.
    link = page.locator("a.goToSystem[title*='Gestiones Personales']").first
    page.wait_for_timeout(1500)
    href = link.get_attribute("href", timeout=30000)
    page.goto(BASE + href, wait_until="domcontentloaded", timeout=60000)
    if "/gestionesperintranet/" not in page.url:
        # algunos sistemas abren en pestaña nueva; buscarla
        for pg in page.context.pages:
            if "/gestionesperintranet/" in pg.url:
                page = pg
                break
    if "/gestionesperintranet/" not in page.url:
        raise Exception(f"El menú no llevó a Gestiones Personales (url={page.url})")
    page.wait_for_timeout(1000)
    page.goto(URL_USUARIOS, wait_until="domcontentloaded", timeout=60000)
    if page.locator("#search_form").count() == 0:
        raise Exception(f"No llegué a la pantalla de usuarios (url={page.url}). ¿El usuario {USUARIO} tiene permiso?")

def filas(page):
    """Filas de la tabla: [{agente, cuil, estado, mail, legajo}]"""
    return page.evaluate(r"""() => [...document.querySelectorAll('table tr')].filter(tr => tr.querySelectorAll('td').length >= 4).map(tr => {
        const td = [...tr.querySelectorAll('td')].map(x => x.innerText.trim());
        const vp = tr.querySelector('.verPendiente');
        return { agente: td[0], cuil: td[1], estado: td[2], mail: td[3], legajo: vp ? vp.getAttribute('data-leg') : null,
                 link: tr.getAttribute('data-link') };
    })""")

def buscar_legajo(page, legajo):
    page.fill("#form_legajo", str(legajo))
    page.fill("#form_nro_doc", "")
    with page.expect_navigation(timeout=60000):
        page.click("#btn_search")
    page.wait_for_load_state("domcontentloaded")

def confirmar(page, legajo, cuil, simular):
    buscar_legajo(page, legajo)
    fs = filas(page)
    # la búsqueda por legajo puede traer varias cuentas del mismo agente: elegir la de su CUIL en "A CONFIRMAR"
    idx = [i for i, f in enumerate(fs) if f["cuil"] == cuil and EST_PEND in f["estado"].upper()]
    if not idx:
        mismos = [f["estado"] for f in fs if f["cuil"] == cuil]
        if mismos:
            return "SALTEADO", "estado actual: " + " / ".join(mismos), fs
        return "ERROR", f"la búsqueda trajo {len(fs)} filas y ninguna es de ese CUIL", fs
    if len(idx) > 1:
        return "ERROR", f"hay {len(idx)} cuentas A CONFIRMAR con ese CUIL", fs
    fila = page.locator("table tr").filter(has=page.locator("td")).nth(idx[0])
    f = fs[idx[0]]
    link = fila.locator(".btn-confirmar-link").first
    if link.count() == 0:
        return "ERROR", "no aparece 'Confirmar usuario' en el menú", f
    if simular:
        return "SIMULADO", "se confirmaría", f
    fila.locator(".dropdown-toggle").first.click()
    link.click()
    page.wait_for_selector("#usuario_confirmar .btn-confirmar", state="visible", timeout=10000)
    with page.expect_navigation(timeout=60000):
        page.click("#usuario_confirmar .btn-confirmar")
    page.wait_for_load_state("domcontentloaded")
    # verificar
    page.goto(URL_USUARIOS, wait_until="domcontentloaded", timeout=60000)
    buscar_legajo(page, legajo)
    est = [x["estado"] for x in filas(page) if x["cuil"] == cuil]
    if any(EST_OK in e.upper() for e in est):
        return "OK", " / ".join(est), f
    return "ERROR", "después de confirmar el estado quedó: " + " / ".join(est), f

def anotar_aviso(f):
    """Confirmado → queda PENDIENTE de aviso por WhatsApp (Reportes → WhatsApp, mig 127).
    Si falla la base, no frena el robot: se avisa en el log."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import mapeo_novedades as MN
        cuil = re.sub(r"\D", "", str(f.get("cuil") or ""))
        if len(cuil) != 11:
            raise ValueError(f"CUIL raro: {f.get('cuil')}")
        cn = MN.conn()
        try:
            with cn.cursor() as cur:
                cur.execute("""INSERT IGNORE INTO gp_avisos_whatsapp (dni, cuil, legajo, agente, confirmado_el)
                               VALUES (%s, %s, %s, %s, CURDATE())""",
                            (int(cuil[2:10]), cuil, f.get("legajo"), (f.get("agente") or "")[:150]))
            cn.commit()
        finally:
            cn.close()
    except Exception as e:
        log(kind="aviso_error", cuil=f.get("cuil"), error=str(e)[:200])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirmar", action="store_true", help="confirma de verdad (sin esto, simula)")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--max", type=int, default=0, help="máximo de usuarios a procesar (0 = todos)")
    a = ap.parse_args()
    simular = not a.confirmar
    log(kind="inicio", usuario=USUARIO, simular=simular)
    res = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PERFIL, channel="chrome", headless=a.headless,
                                                   no_viewport=True, args=["--start-maximized"])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", lambda d: (log(kind="dialog", message=d.message), d.accept()))
        try:
            login(page)
            try:
                entrar_gp(page)
            except Exception as e:
                # sesión vieja colgada (el menú rebota): cerrar sesión y login nuevo
                log(kind="reintento_login", motivo=str(e)[:200])
                cerrar_sesion(page)
                login(page)
                entrar_gp(page)
            pend = [f for f in filas(page) if EST_PEND in f["estado"].upper() and f["legajo"]]
            vistos = set(); pend = [f for f in pend if not (f["cuil"] in vistos or vistos.add(f["cuil"]))]
            log(kind="pendientes", cantidad=len(pend))
            if a.max: pend = pend[:a.max]
            for f in pend:
                try:
                    page.goto(URL_USUARIOS, wait_until="domcontentloaded", timeout=60000)
                    r, det, _ = confirmar(page, f["legajo"], f["cuil"], simular)
                except Exception as e:
                    r, det = "ERROR", str(e)[:200]
                res[r] = res.get(r, 0) + 1
                if r == "OK":
                    anotar_aviso(f)
                log(kind="usuario", resultado=r, detalle=det, legajo=f["legajo"], cuil=f["cuil"], agente=f["agente"])
        except Exception as e:
            log(kind="error_fatal", error=str(e)[:300])
            cerrar_y_salir(ctx, 1)
        log(kind="fin", resumen=res)
        # última línea = motivo en la página Robots
        print(f"Pendientes {sum(res.values())}: confirmados {res.get('OK', 0)}, ya tenían clave provisoria "
              f"{res.get('SALTEADO', 0)}, errores {res.get('ERROR', 0)}", flush=True)
        cerrar_y_salir(ctx, 1 if res.get("ERROR") else 0)

def cerrar_y_salir(ctx, codigo):
    """Si Chrome se colgó, ctx.close() puede no volver nunca y el robot quedaría ocupando el turno
    de la Intranet: se cierra en un hilo con límite de 30 s y se sale igual."""
    import threading
    # el API sync de Playwright no se puede usar desde otro hilo: el hilo solo vigila y corta
    threading.Timer(30, lambda: (sys.stdout.flush(), os._exit(codigo))).start()
    try:
        ctx.close()
    except Exception:
        pass
    sys.stdout.flush()
    os._exit(codigo)

if __name__ == "__main__":
    main()
