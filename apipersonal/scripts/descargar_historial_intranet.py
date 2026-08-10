r"""
Descarga el historial de estructura (Buscar Personal) de la Intranet del Ministerio.
- Recorre los DNIs del Excel de entrada y scrapea TODAS las filas del plantel
  (Legajo, Apellido y Nombre, Parte, Plantel -> Serv., Fecha baja, Cargo).
- No carga nada: es solo lectura, por eso corre sin slow_mo.
- Re-login automático si la sesión expira; re-abre el browser si se cierra.
- Guarda el Excel de salida después de cada DNI; al re-correr saltea los que ya
  tienen filas OK y reintenta los que quedaron en error.

Uso:
    python descargar_historial_intranet.py --pass CLAVE --excel LISTADO.xlsx --dependencia "HOSPITAL" --out SALIDA.xlsx
    python descargar_historial_intranet.py --test ...   # solo primeros 3 DNIs
"""

import os, sys, argparse, time
import pandas as pd
from pathlib import Path
from playwright.sync_api import sync_playwright

# Forzar UTF-8 en la consola: evita que print() de '→', acentos, etc. crashee
# en CMD con codepage cp1252 (UnicodeEncodeError 'charmap').
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

URL_LOGIN   = "https://sistemas.ms.gba.gov.ar/intranet/login.php"
URL_PLANTEL = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/"
USUARIO     = os.environ.get("INTRANET_USER", "xxxxxxx")
CHROME_PROFILE_DIR = os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")

COLUMNAS = ["DNI", "Nombre", "Origen", "Legajo", "Apellido y Nombre", "Parte",
            "Plantel -> Serv.", "Fecha baja", "Cargo", "Estado", "Detalle"]

MAPA_DEP_CODIGO = {
    "HOSPITAL": "1701",
    "UPA 4":    "1699",
    "UPA 18":   "1826",
}

# ── Browser / sesión (mismo esquema que cargar_vacaciones_intranet.py) ──────

def nueva_pagina(playwright):
    try:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            channel="chrome",
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
    except Exception:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
    page = browser.pages[0] if browser.pages else browser.new_page()
    return browser, page

def is_session_expired(page):
    try:
        content = page.content()
        return "acceso denegado" in content.lower() or "no tiene permisos" in content.lower()
    except Exception:
        return False

def error_visible(page):
    """Texto del alert rojo visible en la página (ej: 'no pertenece a su plantel'), o None."""
    try:
        loc = page.locator(".alert-danger").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("×x ").strip()
            if txt:
                return txt[:200]
    except Exception:
        pass
    try:
        if "no pertenece a su plantel" in page.content().lower():
            return "El agente buscado no pertenece a su plantel ni presta servicio en su dependencia."
    except Exception:
        pass
    return None

def login_error_text(page):
    for sel in ["#errors", ".error-message-box", ".alert-danger"]:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0 and loc.is_visible():
                txt = loc.inner_text(timeout=1000).strip().replace("\n", " ")
                if txt:
                    return txt[:200]
        except Exception:
            pass
    try:
        content = page.content()
        if "Código de seguridad incorrecto" in content or "Codigo de seguridad incorrecto" in content:
            return "Código de seguridad incorrecto"
    except Exception:
        pass
    return None

def esperar_login_ok(page, timeout_ms=180000):
    deadline = time.time() + (timeout_ms / 1000)
    avisado = False
    ultimo_error = None
    while time.time() < deadline:
        try:
            if "Parte de Novedades" in page.content():
                return
        except Exception:
            pass
        err = login_error_text(page)
        if err and err != ultimo_error:
            print(f"  Login rechazado: {err}")
            ultimo_error = err
        if err and not avisado:
            print("  Dejo la ventana abierta: apretá Iniciar sesión manualmente. Cuando entre, el script sigue solo.")
            avisado = True
        page.wait_for_timeout(2000)
    raise Exception("No se pudo iniciar sesión en Intranet. Revisar contraseña o reCAPTCHA.")

def login(page, password, dependencia="HOSPITAL"):
    page.goto(URL_LOGIN, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("#username", timeout=6000)
        page.fill("#username", USUARIO)
        page.fill("#password", password)
        page.wait_for_timeout(500)
        page.click("button:has-text('Iniciar')")
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        esperar_login_ok(page)
    except Exception:
        print("  Sesión ya activa, no hace falta re-login")
    page.wait_for_selector("text=Parte de Novedades", timeout=180000)
    page.click("text=Parte de Novedades")
    page.wait_for_load_state("networkidle", timeout=20000)
    cambiar_dependencia(page, dependencia)

def cambiar_dependencia(page, dependencia):
    """Cambia la dependencia de la sesión y verifica contra el chip del header.
    Si el cambio no se confirma, ABORTA (para no leer el plantel equivocado)."""
    codigo = MAPA_DEP_CODIGO.get(dependencia.upper(), "1701")

    try:
        if f"({codigo})" in page.content():
            print(f"  Ya en dependencia {dependencia} ({codigo})")
            return
    except Exception:
        pass

    try:
        for sel in [f"a.dropdown-toggle:has-text('{USUARIO}')",
                    f".dropdown-toggle:has-text('{USUARIO}')",
                    f"a:has-text('{USUARIO}')"]:
            try:
                loc = page.locator(sel).first
                if loc.count() > 0:
                    loc.click(timeout=2000)
                    break
            except Exception:
                continue
        page.wait_for_timeout(300)
        item = page.locator("a:has-text('Cambiar dependencia'), button:has-text('Cambiar dependencia')").first
        try:
            item.click(timeout=2000)
        except Exception:
            try:
                item.click(force=True)
            except Exception:
                pass
        page.wait_for_timeout(600)
    except Exception:
        pass

    try:
        resultado = page.evaluate("""(codigo) => {
            const h4 = document.querySelector('#myModalLabel');
            const scope = (h4 && h4.closest('.modal')) || document;
            const sel = scope.querySelector('select');
            if (!sel) return 'SIN_SELECT';
            let ok = false;
            for (const opt of Array.from(sel.options)) {
                const t = (opt.text || '').trim();
                if (t.startsWith(codigo + ' ') || t.startsWith(codigo + '-') || opt.value === codigo) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    ok = true;
                    break;
                }
            }
            if (!ok) return 'SIN_OPCION';
            const btns = Array.from(scope.querySelectorAll("button, input[type=submit], input[type=button]"));
            const btn = btns.find(b => ((b.innerText || b.value || '').trim().toLowerCase() === 'cambiar'));
            if (!btn) return 'SIN_BOTON';
            btn.click();
            return 'OK';
        }""", codigo)
        if resultado != 'OK':
            print(f"  ADVERTENCIA modal dependencia: {resultado}")
    except Exception as e:
        if "context" not in str(e).lower():
            print(f"  ADVERTENCIA al operar el modal: {e}")

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(800)

    for _ in range(2):
        try:
            if f"({codigo})" in page.content():
                print(f"  Dependencia cambiada a {dependencia} ({codigo})")
                return
        except Exception:
            pass
        try:
            page.reload(wait_until="networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(500)

    raise Exception(f"NO se pudo cambiar la dependencia a {dependencia} ({codigo}) — se aborta para no leer el plantel equivocado")

# ── Scraping ─────────────────────────────────────────────────────────────────

def scrapear_plantel(page, dni, password, dependencia):
    """Busca el DNI en Buscar Personal y devuelve (filas, error).
    filas = lista de dicts con las columnas de la tabla del plantel."""
    for intento in range(2):
        try:
            page.goto(URL_PLANTEL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_selector("input:not([type=hidden])", timeout=10000)

            if is_session_expired(page):
                raise Exception("sesion_expirada")

            page.wait_for_timeout(200)
            # Campo N° Documento: identificado por name/id ('documento'/'dni') o por su label —
            # nunca posicional
            info_dni = page.evaluate("""() => {
                const usable = Array.from(document.querySelectorAll('input')).filter(i =>
                    !['hidden','submit','button','checkbox','radio'].includes((i.type || '').toLowerCase()));
                const clave = i => ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '')).toLowerCase();
                let el = usable.find(i => clave(i).includes('documento') || clave(i).includes('dni'));
                if (!el) {
                    for (const lb of Array.from(document.querySelectorAll('label'))) {
                        if ((lb.textContent || '').toLowerCase().includes('documento')) {
                            const forId = lb.getAttribute('for');
                            el = (forId && document.getElementById(forId)) ||
                                 (lb.parentElement && lb.parentElement.querySelector('input'));
                            if (el) break;
                        }
                    }
                }
                if (!el) return null;
                document.querySelectorAll('[data-pw-dni]').forEach(e => e.removeAttribute('data-pw-dni'));
                el.setAttribute('data-pw-dni', '1');
                return { name: el.name || '', id: el.id || '' };
            }""")
            if not info_dni:
                return None, "No se encontró el campo N° Documento en Buscar Personal"
            if not getattr(scrapear_plantel, "_dni_impreso", False):
                print(f"  Campo DNI identificado: {info_dni}")
                scrapear_plantel._dni_impreso = True
            campo_dni = page.locator("[data-pw-dni='1']")
            campo_dni.click()
            campo_dni.fill(str(int(dni)))
            page.get_by_role("button", name="Buscar").click()
            page.wait_for_load_state("networkidle", timeout=15000)

            msg_pag = error_visible(page)
            if msg_pag:
                return None, msg_pag

            page.wait_for_selector("table tbody tr", timeout=10000)

            res_js = page.evaluate("""() => {
                // Ubicar la tabla del plantel por su FILA DE ENCABEZADO (Parte + Fecha baja).
                // OJO: los encabezados NO están en <thead> en esta página — se busca la
                // fila de títulos dentro de cada tabla y los datos son las filas siguientes.
                let cols = [], rows = [];
                for (const t of Array.from(document.querySelectorAll('table'))) {
                    const filas = Array.from(t.querySelectorAll('tr'));
                    for (let k = 0; k < filas.length; k++) {
                        const cells = Array.from(filas[k].querySelectorAll('th,td')).map(x => (x.textContent || '').trim().toLowerCase());
                        if (cells.length >= 4 && cells.some(c => c.includes('parte')) && cells.some(c => c.includes('baja'))) {
                            cols = cells;
                            rows = filas.slice(k + 1).filter(r => r.querySelectorAll('td').length >= 3);
                            break;
                        }
                    }
                    // sin break externo: si hay tablas anidadas, la más interna pisa a la envolvente
                }
                if (!cols.length) return { error: 'No se encontró la tabla del plantel' };
                if (rows.length === 0) return { error: 'Sin filas en el plantel' };
                const idx = {
                    legajo:  cols.findIndex(c => c.includes('legajo')),
                    nombre:  cols.findIndex(c => c.includes('apellido')),
                    parte:   cols.findIndex(c => c.includes('parte')),
                    plantel: cols.findIndex(c => c.includes('plantel')),
                    baja:    cols.findIndex(c => c.includes('baja')),
                    cargo:   cols.findIndex(c => c.includes('cargo')),
                };
                const celda = (tr, i) => { const t = tr.querySelectorAll('td'); return (i >= 0 && t[i]) ? (t[i].textContent || '').trim().replace(/\\s+/g, ' ') : ''; };
                return { filas: rows.map(tr => ({
                    legajo:  celda(tr, idx.legajo),
                    nombre:  celda(tr, idx.nombre),
                    parte:   celda(tr, idx.parte),
                    plantel: celda(tr, idx.plantel),
                    baja:    celda(tr, idx.baja),
                    cargo:   celda(tr, idx.cargo),
                })) };
            }""")

            if not isinstance(res_js, dict) or not res_js.get("filas"):
                motivo = res_js.get("error") if isinstance(res_js, dict) else None
                return None, motivo or "No se pudo leer la tabla del plantel"
            return res_js["filas"], None

        except Exception as e:
            msg = str(e)
            msg_pag = error_visible(page)
            if msg_pag:
                return None, msg_pag
            if "sesion_expirada" in msg or "acceso denegado" in msg.lower() or intento == 0:
                if intento == 0:
                    print("  Sesión expirada / error, re-login...")
                    try:
                        login(page, password, dependencia)
                        continue
                    except Exception as le:
                        return None, f"Re-login falló: {le}"
            return None, msg[:200]

    return None, "No se pudo scrapear tras re-login"

# ── Excel entrada / salida ───────────────────────────────────────────────────

def cargar_listado(excel_path, test_mode=False):
    df = pd.read_excel(excel_path)
    if "DNI" not in df.columns:
        print(f"El Excel de entrada no tiene columna DNI: {excel_path}")
        sys.exit(1)
    filas = df.to_dict("records")
    if test_mode:
        filas = filas[:3]
    return filas

def cargar_salida_existente(out_path):
    """Devuelve (registros, dnis_ok): filas previas y DNIs que ya tienen filas OK."""
    if not Path(out_path).exists():
        return [], set()
    try:
        df = pd.read_excel(out_path)
        registros = df.to_dict("records")
        dnis_ok = {str(r["DNI"]) for r in registros if str(r.get("Estado", "")).upper() == "OK"}
        return registros, dnis_ok
    except Exception:
        return [], set()

def guardar_salida(out_path, registros):
    df = pd.DataFrame(registros, columns=COLUMNAS)
    df.to_excel(out_path, index=False)

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--excel", dest="excel_path", required=True, help="Listado de entrada (DNI, Nombre, Origen)")
    parser.add_argument("--dependencia", default="HOSPITAL")
    parser.add_argument("--out", dest="out_path", required=True, help="Excel de salida")
    args = parser.parse_args()

    password    = args.password or os.environ.get("INTRANET_PASS") or input("Contraseña: ")
    dependencia = args.dependencia.upper().replace("UPA4", "UPA 4").replace("UPA18", "UPA 18")

    filas = cargar_listado(args.excel_path, test_mode=args.test)
    registros, dnis_ok = cargar_salida_existente(args.out_path)
    if dnis_ok:
        print(f"Salida existente: {len(dnis_ok)} DNIs ya scrapeados OK (se saltean)")

    pendientes = [f for f in filas if str(int(f["DNI"])) not in dnis_ok]
    print(f"Dependencia: {dependencia}")
    print(f"DNIs a procesar: {len(pendientes)} (de {len(filas)} del listado)")
    if not pendientes:
        print("Nada pendiente.")
        return

    ok_count = err_count = 0
    t0 = time.time()

    with sync_playwright() as p:
        browser, page = nueva_pagina(p)

        print("Iniciando sesión...")
        try:
            login(page, password, dependencia)
        except Exception as e:
            print(f"ERROR en login: {e}")
            browser.close()
            return
        print("Sesión iniciada.\n")

        for i, fila in enumerate(pendientes, 1):
            dni    = fila["DNI"]
            nombre = str(fila.get("Nombre", ""))
            origen = str(fila.get("Origen", ""))
            print(f"[{i}/{len(pendientes)}] {nombre} (DNI {int(dni)})")

            # Re-abrir browser si se cerró
            try:
                page.title()
            except Exception:
                print("  Browser cerrado, reabriendo...")
                try:
                    browser.close()
                except Exception:
                    pass
                browser, page = nueva_pagina(p)
                try:
                    login(page, password, dependencia)
                    print("  Re-login OK")
                except Exception as e:
                    print(f"  Re-login falló: {e}")
                    break

            try:
                filas_plantel, msg_err = scrapear_plantel(page, dni, password, dependencia)
            except Exception as e:
                filas_plantel, msg_err = None, str(e)[:200]

            # Reemplazar filas previas de este DNI (reintento de errores sin duplicar)
            registros = [r for r in registros if str(r.get("DNI", "")) != str(int(dni))]

            if filas_plantel:
                print(f"  OK — {len(filas_plantel)} fila(s) de plantel")
                ok_count += 1
                for fp in filas_plantel:
                    registros.append({
                        "DNI": int(dni), "Nombre": nombre, "Origen": origen,
                        "Legajo": fp["legajo"], "Apellido y Nombre": fp["nombre"],
                        "Parte": fp["parte"], "Plantel -> Serv.": fp["plantel"],
                        "Fecha baja": fp["baja"], "Cargo": fp["cargo"],
                        "Estado": "OK", "Detalle": "",
                    })
            else:
                print(f"  ERROR: {msg_err}")
                err_count += 1
                registros.append({
                    "DNI": int(dni), "Nombre": nombre, "Origen": origen,
                    "Legajo": "", "Apellido y Nombre": "", "Parte": "",
                    "Plantel -> Serv.": "", "Fecha baja": "", "Cargo": "",
                    "Estado": "ERROR", "Detalle": msg_err or "",
                })

            guardar_salida(args.out_path, registros)

        mins = (time.time() - t0) / 60
        print(f"\nResultado: {ok_count} OK, {err_count} errores en {mins:.1f} min.")
        print(f"Salida: {args.out_path}")
        try:
            browser.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
