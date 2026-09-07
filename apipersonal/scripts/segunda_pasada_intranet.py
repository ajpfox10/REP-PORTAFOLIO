r"""
Segunda pasada de carga en la Intranet.
Lee filas ya procesadas (del resultado_carga.xlsx o Excel pasado por --excel)
y reintenta cargar las que tienen ERROR.

Uso:
    python segunda_pasada_intranet.py --pass TU_CLAVE --excel D:\G\comparacion\segunda_pasada.xlsx
"""

import os, sys, argparse, re, time
import pandas as pd
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

# Forzar UTF-8 en la consola: evita que print() de '→', acentos, etc. crashee
# en CMD con codepage cp1252 (UnicodeEncodeError 'charmap').
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

LOG_PATH  = r"D:\G\comparacion\resultado_carga.xlsx"
URL_LOGIN   = "https://sistemas.ms.gba.gov.ar/intranet/login.php"
URL_PLANTEL = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/"
BASE_URL    = "https://sistemas.ms.gba.gov.ar"
USUARIO     = os.environ.get("INTRANET_USER", "xxxxxxx")
CHROME_PROFILE_DIR = os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")
SIAPE_DIR = r"D:\G\comparacion\SIAPE"
LABEL_ENF_PENDIENTE = "E - LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)"

MAPA_DEP_CODIGO = {
    "HOSPITAL": "1701",
    "UPA 4":    "1699",
    "UPA 18":   "1826",
}

def nueva_pagina(playwright):
    try:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            channel="chrome",
            headless=False,
            slow_mo=150,
            args=["--disable-blink-features=AutomationControlled"],
        )
    except Exception:
        browser = playwright.chromium.launch_persistent_context(
            CHROME_PROFILE_DIR,
            headless=False,
            slow_mo=150,
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

def _sin_acentos(s):
    import unicodedata
    return unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().upper()

def fmt_fecha(val):
    if pd.isnull(val):
        return None
    if isinstance(val, (int, float)):
        val = pd.to_datetime(val, unit="D", origin="1899-12-30")
    elif isinstance(val, str):
        val = pd.to_datetime(val, dayfirst=True, errors="coerce")
    if pd.isnull(val):
        return None
    return val.strftime("%d/%m/%Y")

def es_medica_sin_justificar(label):
    s = _sin_acentos(label)
    return (
        "POR RAZONES DE ENFERMEDAD" in s
        or "LICENCIA POR ENFERMEDAD" in s
        or "ATENCION FAMILIAR ENFERMO" in s
        or "ENFERMEDAD DE FAMILIAR" in s
    )

def cargar_justificados_siape():
    import glob
    just = {}
    for fp in glob.glob(os.path.join(SIAPE_DIR, "*.xls*")):
        if os.path.basename(fp).startswith("~$"):
            continue
        try:
            df = pd.read_excel(fp)
        except Exception:
            continue
        if "JUSTIFICADO" not in df.columns:
            continue
        for _, r in df.iterrows():
            try:
                dni = int(r.get("NRO_DOCUMENTO"))
            except Exception:
                continue
            nov = _sin_acentos(r.get("NOVEDAD", ""))
            desde = fmt_fecha(r.get("FECHA_DESDE"))
            hasta = fmt_fecha(r.get("FECHA_HASTA"))
            justificado = str(r.get("JUSTIFICADO", "")).strip().upper()
            if dni and nov and desde and hasta:
                just[(dni, nov, desde, hasta)] = justificado
    return just

def ajustar_label_por_justificado(dni, label, desde, hasta, justificados):
    if not es_medica_sin_justificar(label):
        return label
    try:
        dni_i = int(dni)
    except Exception:
        return label
    d1 = _parse_fecha_ddmmyyyy(desde)
    d2 = _parse_fecha_ddmmyyyy(hasta)
    if not d1 or not d2:
        return label
    for (j_dni, nov, j_desde, j_hasta), justificado in justificados.items():
        if j_dni != dni_i or justificado != "NO":
            continue
        if not ("ENFERMEDAD" in nov or "ATENCION FAMILIAR ENFERMO" in nov):
            continue
        e1 = _parse_fecha_ddmmyyyy(j_desde)
        e2 = _parse_fecha_ddmmyyyy(j_hasta)
        if e1 and e2 and not (d1 > e2 or d2 < e1):
            return LABEL_ENF_PENDIENTE
    return label

def exito_visible(page):
    """Texto del alert verde de éxito visible en la página, o None."""
    try:
        loc = page.locator(".alert-success").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("×x ").strip()
            if txt:
                return txt[:200]
    except Exception:
        pass
    return None

def novedad_ya_cargada(page, label, desde, hasta):
    """True si la tabla de novedades del agente ya muestra label+desde+hasta (no eliminada).
    Se usa estando en la página /list del agente. Ej: 'DESCANSO ANUAL | 20/07/2026 | 02/08/2026'.
    """
    try:
        nombre = label.split(" - ", 1)[1].strip().upper() if " - " in label else str(label).strip().upper()
        return bool(page.evaluate("""(args) => {
            const [nombre, desde, hasta] = args;
            for (const table of Array.from(document.querySelectorAll('table'))) {
                // Encabezados NO están en <thead>: buscar la fila de títulos a mano
                const filas = Array.from(table.querySelectorAll('tr'));
                let ths = [], dataRows = [];
                for (let k = 0; k < filas.length; k++) {
                    const cells = Array.from(filas[k].querySelectorAll('th,td')).map(x => (x.textContent || '').trim().toLowerCase());
                    if (cells.some(h => h.includes('novedad')) && cells.some(h => h.includes('desde')) && cells.some(h => h.includes('hasta'))) {
                        ths = cells;
                        dataRows = filas.slice(k + 1);
                        break;
                    }
                }
                if (!ths.length) continue;
                const iCod   = ths.findIndex(h => h.includes('novedad'));
                const iDesde = ths.findIndex(h => h.includes('desde'));
                const iHasta = ths.findIndex(h => h.includes('hasta'));
                const iElim  = ths.findIndex(h => h.includes('elimin'));
                for (const tr of dataRows) {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
                    const cod  = (tds[iCod] || '').toUpperCase();
                    const elim = iElim >= 0 ? (tds[iElim] || '').toUpperCase() : 'NO';
                    if (cod.includes(nombre) && tds[iDesde] === desde && tds[iHasta] === hasta && !elim.startsWith('S')) {
                        return true;
                    }
                }
            }
            return false;
        }""", [nombre, str(desde), str(hasta)]))
    except Exception:
        return False

def es_anual_o_complementaria(label):
    n = _sin_acentos(label)
    return "DESCANSO ANUAL" in n or "COMPLEMENTARIA" in n

def ajuste_maximo_mensual(label, mensaje, desde, hasta):
    """Detecta 'maximo permitido de X dias por mes' y devuelve (X, nuevo_hasta)."""
    if not es_anual_o_complementaria(label):
        return None
    msg = _sin_acentos(mensaje or "")
    m = re.search(r"M.?XIMO PERMITIDO DE\s+(\d+)\s+D.?AS POR MES", msg)
    if not m:
        return None
    max_dias = int(m.group(1))
    if max_dias <= 0:
        return None
    try:
        d_desde = datetime.strptime(str(desde), "%d/%m/%Y")
        d_hasta = datetime.strptime(str(hasta), "%d/%m/%Y")
    except Exception:
        return None
    nuevo_hasta = d_desde + timedelta(days=max_dias - 1)
    if nuevo_hasta >= d_hasta:
        return None
    return max_dias, nuevo_hasta.strftime("%d/%m/%Y")

def login(page, password, dependencia="HOSPITAL"):
    page.goto(URL_LOGIN, wait_until="domcontentloaded", timeout=30000)
    try:
        page.wait_for_selector("#username", timeout=6000)
        page.fill("#username", USUARIO)
        page.fill("#password", password)
        page.wait_for_timeout(500)
        page.click("form button[type=submit]")
        try:
            page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        esperar_login_ok(page)
    except Exception:
        # No apareció el form de login → la sesión sigue viva (login.php redirige)
        print("  Sesión ya activa, no hace falta re-login")
    page.wait_for_selector("text=Parte de Novedades", timeout=180000)
    page.click("text=Parte de Novedades")
    page.wait_for_load_state("networkidle", timeout=20000)

    # Cambiar a la dependencia destino (UPA 4, UPA 18, HOSPITAL)
    cambiar_dependencia(page, dependencia)

def cambiar_dependencia(page, dependencia):
    """Cambia la dependencia de la sesión (perfil multidependencia).
    Opera el modal 'Cambiar Dependencia' DIRECTO por JS (sirve visible u oculto)
    y verifica contra el chip del header 'xxxxxxx (codigo)'.
    Si el cambio no se confirma, ABORTA (para no cargar en la dependencia equivocada).
    """
    codigo = MAPA_DEP_CODIGO.get(dependencia.upper(), "1701")

    # ¿Ya estamos en la dependencia pedida? El header muestra "xxxxxxx (1701)"
    try:
        if f"({codigo})" in page.content():
            print(f"  Ya en dependencia {dependencia} ({codigo})")
            return
    except Exception:
        pass

    # Intento UI (best-effort): abrir menú de usuario y click en "Cambiar dependencia"
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

    # Operar el modal por JS: setear el select y clickear "Cambiar".
    # No depende de visibilidad — el modal existe en el DOM (#myModalLabel).
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
        # Si el click navegó y destruyó el contexto JS, no es error: pasamos a verificar
        if "context" not in str(e).lower():
            print(f"  ADVERTENCIA al operar el modal: {e}")

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(800)

    # Verificación DURA contra el header; un reload por si quedó cacheado
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

    raise Exception(f"NO se pudo cambiar la dependencia a {dependencia} ({codigo}) — se aborta para no cargar en la dependencia equivocada")

def ir_a_novedades(page, dni, password, dependencia="HOSPITAL", nombre=None):
    for intento in range(2):
        try:
            page.goto(URL_PLANTEL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_selector("input:not([type=hidden])", timeout=10000)
            if is_session_expired(page):
                raise Exception("sesion_expirada")
            page.wait_for_timeout(400)
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
                return False, "No se encontró el campo N° Documento en Buscar Personal"
            if not getattr(ir_a_novedades, "_dni_impreso", False):
                print(f"  Campo DNI identificado: {info_dni}")
                ir_a_novedades._dni_impreso = True
            campo_dni = page.locator("[data-pw-dni='1']")
            campo_dni.click()
            campo_dni.fill(str(int(dni)))
            page.get_by_role("button", name="Buscar").click()
            page.wait_for_load_state("networkidle", timeout=15000)

            # Capturar el error que muestra la página (ej: "no pertenece a su plantel")
            msg_pag = error_visible(page)
            if msg_pag:
                return False, msg_pag

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
                const idxParte = cols.findIndex(c => c.includes('parte'));
                const idxBaja  = cols.findIndex(c => c.includes('baja'));
                const idxNom   = cols.findIndex(c => c.includes('apellido'));
                const celda = (tr, i) => { const t = tr.querySelectorAll('td'); return (i >= 0 && t[i]) ? (t[i].textContent || '').trim() : ''; };

                // SOLO activas (sin fecha de baja) y NUNCA HORAS CATEDRA
                const activos = rows.filter(tr => {
                    const baja = celda(tr, idxBaja);
                    const activa = baja === '' || baja.includes('0---');
                    return activa && !celda(tr, idxParte).toUpperCase().includes('HORAS CATEDRA');
                });
                if (activos.length === 0) return { error: 'Sin fila válida: todas con baja o HORAS CATEDRA' };

                // Prioridad de parte: PLANTA > BECAS > otras (a igual prioridad, la última)
                const score = tr => {
                    const p = celda(tr, idxParte).toUpperCase();
                    if (p.includes('PLANTA')) return 3;
                    if (p.includes('BECA')) return 2;
                    return 1;
                };
                let fila = activos[0];
                for (const tr of activos) { if (score(tr) >= score(fila)) fila = tr; }
                for (const a of fila.querySelectorAll('.dropdown-menu a')) {
                    if (a.textContent.trim() === 'Novedades') {
                        return { href: a.getAttribute('href'), parte: celda(fila, idxParte), nombre: celda(fila, idxNom) };
                    }
                }
                return { error: 'La fila elegida no tiene link Novedades' };
            }""")
            href = res_js.get('href') if isinstance(res_js, dict) else None
            if not href:
                motivo = res_js.get('error') if isinstance(res_js, dict) else None
                return False, motivo or "No se encontró link Novedades"
            print(f"  Fila plantel elegida: {res_js.get('nombre','?')} | {res_js.get('parte','?')}")
            page.goto(f"{BASE_URL}{href}", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_load_state("networkidle", timeout=15000)
            return True, None
        except Exception as e:
            msg = str(e)
            # Si la página muestra un error concreto, reportar ESE (no el timeout de Playwright)
            msg_pag = error_visible(page)
            if msg_pag:
                return False, msg_pag
            if "sesion_expirada" in msg or intento == 0:
                if intento == 0:
                    print("  Sesión expirada, re-login...")
                    try:
                        login(page, password, dependencia)
                        continue
                    except Exception as le:
                        return False, f"Re-login falló: {le}"
            return False, msg
    return False, "No se pudo navegar tras re-login"

def cargar_novedad(page, label, desde, hasta):
    try:
        # Select de la novedad: primero por id/name del form Symfony (personalnovedadtype);
        # recién si no está, por el texto "Seleccione"
        select_nov = page.locator("select[id*='personalnovedadtype'], select[name*='personalnovedadtype']").first
        try:
            select_nov.wait_for(timeout=4000)
        except Exception:
            select_nov = page.locator("select").filter(has_text="Seleccione").first
            select_nov.wait_for(timeout=6000)
        try:
            info_sel = select_nov.evaluate("el => ({ name: el.name || '', id: el.id || '' })")
            if not getattr(cargar_novedad, "_sel_impreso", False):
                print(f"  Select novedad identificado: {info_sel}")
                cargar_novedad._sel_impreso = True
        except Exception:
            pass
        # Buscar la opción real del desplegable (insensible a acentos/mayúsculas)
        opciones = select_nov.evaluate("el => Array.from(el.options).map(o => o.text.trim())")
        label_n = _sin_acentos(label).strip()
        real = next((op for op in opciones if _sin_acentos(op).strip() == label_n), None)
        if real is None:
            real = next((op for op in opciones if label_n and label_n in _sin_acentos(op)), None)
        if real is None:
            return False, "Opción no disponible en este plantel"
        select_nov.select_option(label=real)
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Continuar").click()
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        msg_pag = error_visible(page)   # capturar ANTES de go_back
        try:
            page.go_back()
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        return False, msg_pag or f"Error al seleccionar: {e}"

    # Completar fechas — campos EXACTOS del formulario de la novedad (Symfony).
    # Los del filtro del historial tienen otros nombres: imposible confundirse.
    try:
        SEL_DESDE = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaDesde"
        SEL_HASTA = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaHasta"
        try:
            page.wait_for_selector(SEL_DESDE, state="attached", timeout=8000)
        except Exception:
            msg_pag = error_visible(page)
            try:
                page.go_back()
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            return False, msg_pag or "No apareció el formulario de fechas — no se cargó"

        campo_desde = page.locator(SEL_DESDE)
        campo_hasta = page.locator(SEL_HASTA)
        campo_desde.click()
        campo_desde.press_sequentially(desde, delay=80)
        page.wait_for_timeout(300)
        campo_hasta.click()
        campo_hasta.press_sequentially(hasta, delay=80)
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Guardar").click()
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        return False, f"Error al guardar: {e}"

    # ¿Éxito? Capturar el cartel verde textual (queda como constancia en el log)
    ok_msg = exito_visible(page)
    if ok_msg:
        return True, ok_msg
    if "correctamente" in page.content().lower():
        return True, "Guardado correctamente (confirmación detectada en la página)"

    try:
        msg = page.locator(".alert, .error, .alert-danger, [class*='error'], [class*='alert']").first.inner_text(timeout=2000)
        msg = msg.strip().replace("\n", " ")[:200]
    except Exception:
        msg = "sin confirmación (sin mensaje de error capturado)"

    try:
        page.go_back()
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    return False, msg

def guardar_log(registros):
    df = pd.DataFrame(registros, columns=["Nombre", "DNI", "Novedad", "Desde", "Hasta", "Estado", "Detalle"])
    df.to_excel(LOG_PATH, index=False)

def es_error_superposicion(mensaje):
    return "SUPERPONE" in _sin_acentos(mensaje or "")

def _parse_fecha_ddmmyyyy(valor):
    try:
        return datetime.strptime(str(valor).strip(), "%d/%m/%Y").date()
    except Exception:
        return None

def _nombre_novedad(label):
    s = str(label or "").strip()
    return s.split(" - ", 1)[1].strip() if " - " in s else s

def leer_historial_novedades(page):
    """Lee la tabla Historial de Novedades visible en /list del agente."""
    try:
        filas = page.evaluate("""() => {
            const out = [];
            const pick = (arr, i) => (i >= 0 && arr[i] ? arr[i] : '').trim();
            for (const table of Array.from(document.querySelectorAll('table'))) {
                const trs = Array.from(table.querySelectorAll('tr'));
                let headers = [];
                let start = -1;
                for (let k = 0; k < trs.length; k++) {
                    const cells = Array.from(trs[k].querySelectorAll('th,td')).map(x => (x.textContent || '').trim().toLowerCase());
                    if (cells.some(h => h.includes('novedad')) && cells.some(h => h.includes('desde')) && cells.some(h => h.includes('hasta'))) {
                        headers = cells;
                        start = k + 1;
                        break;
                    }
                }
                if (start < 0) continue;
                const iNov = headers.findIndex(h => h.includes('novedad'));
                const iDesde = headers.findIndex(h => h.includes('desde'));
                const iHasta = headers.findIndex(h => h.includes('hasta'));
                const iDias = headers.findIndex(h => h.includes('dia') || h.includes('dias'));
                const iMin = headers.findIndex(h => h.includes('min'));
                const iElim = headers.findIndex(h => h.includes('elimin'));
                for (const tr of trs.slice(start)) {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
                    if (!tds.length) continue;
                    const desde = pick(tds, iDesde);
                    const hasta = pick(tds, iHasta);
                    if (!/^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(desde) || !/^\\d{2}\\/\\d{2}\\/\\d{4}$/.test(hasta)) continue;
                    out.push({
                        novedad: pick(tds, iNov),
                        desde,
                        hasta,
                        dias: pick(tds, iDias),
                        min: pick(tds, iMin),
                        eliminado: iElim >= 0 ? pick(tds, iElim) : 'NO',
                    });
                }
            }
            return out;
        }""")
        return filas if isinstance(filas, list) else []
    except Exception:
        return []

def detalle_superposicion(page, label, desde, hasta, mensaje_original, historial_url=None):
    if historial_url:
        try:
            if page.url != historial_url or "Historial de Novedades" not in page.content():
                page.goto(historial_url, wait_until="domcontentloaded", timeout=15000)
                page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

    d1 = _parse_fecha_ddmmyyyy(desde)
    d2 = _parse_fecha_ddmmyyyy(hasta)
    if not d1 or not d2:
        return (mensaje_original or "Existe una novedad o licencia cargada que se superpone con la que intenta ingresar.")[:500]

    intento_norm = _sin_acentos(_nombre_novedad(label))
    coincidencias = []
    historial = leer_historial_novedades(page)
    for row in historial:
        eliminado = _sin_acentos(row.get("eliminado") or "NO")
        if eliminado.startswith("S"):
            continue
        e1 = _parse_fecha_ddmmyyyy(row.get("desde"))
        e2 = _parse_fecha_ddmmyyyy(row.get("hasta"))
        if not e1 or not e2 or d1 > e2 or d2 < e1:
            continue
        existente_norm = _sin_acentos(row.get("novedad") or "")
        misma_novedad = bool(intento_norm and (intento_norm == existente_norm or intento_norm in existente_norm or existente_norm in intento_norm))
        exacta = str(row.get("desde")) == str(desde) and str(row.get("hasta")) == str(hasta)
        coincidencias.append((0 if exacta else 1, 0 if misma_novedad else 1, exacta, misma_novedad, row))

    if not coincidencias:
        base = mensaje_original or "Existe una novedad o licencia cargada que se superpone con la que intenta ingresar."
        return f"{base} | Lei {len(historial)} fila(s) del Historial de Novedades, pero ninguna cruza por fecha con {desde} a {hasta}."

    coincidencias.sort(key=lambda x: (x[0], x[1], x[4].get("desde", ""), x[4].get("novedad", "")))
    exacta = coincidencias[0][2]
    partes = []
    for _, _, _, misma_novedad, row in coincidencias[:3]:
        extra = []
        if row.get("dias"):
            extra.append(f"dias {row.get('dias')}")
        if row.get("min"):
            extra.append(f"min {row.get('min')}")
        extra.append("misma novedad" if misma_novedad else "distinta novedad")
        suf = f" ({', '.join(extra)})" if extra else ""
        partes.append(f"{row.get('novedad')} {row.get('desde')} a {row.get('hasta')}{suf}")
    tipo = "Superposicion exacta" if exacta else "Superposicion no exacta"
    return f"{tipo}: intentaba {label} {desde} a {hasta}; se pisa con {' | '.join(partes)}"

def cargar_log_existente():
    ok_set = set()
    if not Path(LOG_PATH).exists():
        return ok_set, []
    try:
        df = pd.read_excel(LOG_PATH)
        rows = df.to_dict("records")
        for r in rows:
            if str(r.get("Estado", "")).upper() == "OK":
                k = f"{int(r['DNI'])}|{r['Novedad']}|{r['Desde']}|{r['Hasta']}"
                ok_set.add(k)
        return ok_set, rows
    except Exception:
        return ok_set, []

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--excel", dest="excel_path", required=True)
    parser.add_argument("--dependencia", dest="dependencia", default="HOSPITAL")
    parser.add_argument("--log", dest="log_path", default=None)
    args = parser.parse_args()
    if args.log_path:
        global LOG_PATH
        LOG_PATH = args.log_path

    password    = args.password or os.environ.get("INTRANET_PASS") or input("Contraseña: ")
    dependencia = args.dependencia.upper()

    df = pd.read_excel(args.excel_path)
    # Acepta columnas de resultado_carga.xlsx: Nombre, DNI, Novedad, Desde, Hasta
    filas = df.to_dict("records")
    if not filas:
        print("No hay filas en el Excel.")
        sys.exit(0)
    justificados = cargar_justificados_siape()
    if justificados:
        print(f"Cruce JUSTIFICADO: {len(justificados)} filas leídas de SIAPE.xlsx")

    # Agrupar por DNI
    from collections import defaultdict
    grupos = defaultdict(list)
    for f in filas:
        label = ajustar_label_por_justificado(f["DNI"], f.get("Novedad", ""), f.get("Desde", ""), f.get("Hasta", ""), justificados)
        if label != str(f.get("Novedad", "")):
            print(f"    {f.get('Nombre', '')}: {f.get('Novedad', '')} sin justificar -> se reintenta como E-PENDIENTE")
        grupos[f["DNI"]].append({
            "nombre": str(f.get("Nombre", "")),
            "label":  label,
            "desde":  str(f.get("Desde", "")),
            "hasta":  str(f.get("Hasta", "")),
        })

    ya_ok, registros = cargar_log_existente()
    print(f"Agentes a procesar: {len(grupos)}")

    ok_count  = sum(1 for r in registros if r.get("Estado") == "OK")
    err_count = sum(1 for r in registros if r.get("Estado") != "OK")
    run_ok_count = 0
    run_err_count = 0
    run_skip_count = 0

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

        for i, (dni, novedades) in enumerate(grupos.items(), 1):
            nombre = novedades[0]["nombre"]
            pendientes = [
                nov for nov in novedades
                if f"{int(dni)}|{nov['label']}|{nov['desde']}|{nov['hasta']}" not in ya_ok
            ]
            if not pendientes:
                print(f"[{i}/{len(grupos)}] {nombre} — ya OK, se salta")
                run_skip_count += len(novedades)
                continue

            print(f"[{i}/{len(grupos)}] {nombre} (DNI {int(dni)}) — {len(pendientes)} pendiente(s)")

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
                except Exception as e:
                    print(f"  Re-login falló: {e}")
                    break

            try:
                exito_nav, msg_nav = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                if not exito_nav:
                    for nov in pendientes:
                        _actualizar_registro(registros, int(dni), nov["label"], nov["desde"], nov["hasta"],
                                             "ERROR_NAV", msg_nav)
                        err_count += 1
                        run_err_count += 1
                    guardar_log(registros)
                    continue

                for nov in pendientes:
                    # ¿Ya figura en la tabla de novedades del agente? (quedó cargada pero el log decía error)
                    if novedad_ya_cargada(page, nov["label"], nov["desde"], nov["hasta"]):
                        print(f"  Ya estaba cargada en la Intranet: {nov['label']} {nov['desde']} - {nov['hasta']} — OK")
                        ok_count += 1
                        run_ok_count += 1
                        ya_ok.add(f"{int(dni)}|{nov['label']}|{nov['desde']}|{nov['hasta']}")
                        _actualizar_registro(registros, int(dni), nov["label"], nov["desde"], nov["hasta"],
                                             "OK", "Ya estaba cargada en la Intranet")
                        guardar_log(registros)
                        continue

                    print(f"  Cargando: {nov['label']} {nov['desde']} → {nov['hasta']}")
                    try:
                        historial_url = page.url
                        exito, msg_err = cargar_novedad(page, nov["label"], nov["desde"], nov["hasta"])
                        if exito:
                            print(f"  OK — {msg_err}" if msg_err else "  OK")
                            ok_count += 1
                            run_ok_count += 1
                            ya_ok.add(f"{int(dni)}|{nov['label']}|{nov['desde']}|{nov['hasta']}")
                            estado, detalle = "OK", msg_err or ""
                        else:
                            if es_error_superposicion(msg_err):
                                msg_err = detalle_superposicion(page, nov["label"], nov["desde"], nov["hasta"], msg_err, historial_url)
                            ajuste = ajuste_maximo_mensual(nov["label"], msg_err, nov["desde"], nov["hasta"])
                            if ajuste:
                                max_dias, hasta_ajustado = ajuste
                                print(f"  Ajuste por maximo mensual: reintento {nov['desde']} -> {hasta_ajustado} ({max_dias} dias)")
                                exito_nav2, msg_nav2 = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                                if exito_nav2:
                                    exito2, msg2 = cargar_novedad(page, nov["label"], nov["desde"], hasta_ajustado)
                                else:
                                    exito2, msg2 = False, f"No se pudo volver para ajuste: {msg_nav2}"
                                if exito2:
                                    print(f"  OK AJUSTADO - {msg2}" if msg2 else "  OK AJUSTADO")
                                    ok_count += 1
                                    run_ok_count += 1
                                    ya_ok.add(f"{int(dni)}|{nov['label']}|{nov['desde']}|{nov['hasta']}")
                                    estado = "OK"
                                    detalle = (f"OK AJUSTADO: maximo {max_dias} dias por mes. "
                                               f"Original {nov['desde']} a {nov['hasta']}; "
                                               f"cargado {nov['desde']} a {hasta_ajustado}. {msg2 or ''}").strip()
                                else:
                                    print(f"  ERROR AJUSTE: {msg2}")
                                    err_count += 1
                                    run_err_count += 1
                                    estado = "ERROR"
                                    detalle = f"{msg_err or ''} | Ajuste {nov['desde']} a {hasta_ajustado} fallo: {msg2 or ''}"[:200]
                            else:
                                print(f"  ERROR: {msg_err}")
                                err_count += 1
                                run_err_count += 1
                                estado, detalle = "ERROR", msg_err or ""
                    except Exception as e:
                        print(f"  EXCEPCIÓN: {e}")
                        err_count += 1
                        run_err_count += 1
                        estado, detalle = "EXCEPCION", str(e)[:200]

                    _actualizar_registro(registros, int(dni), nov["label"], nov["desde"], nov["hasta"],
                                         estado, detalle)
                    guardar_log(registros)

            except Exception as e:
                print(f"  EXCEPCIÓN GENERAL: {e}")
                for nov in pendientes:
                    _actualizar_registro(registros, int(dni), nov["label"], nov["desde"], nov["hasta"],
                                         "EXCEPCION", str(e)[:200])
                    err_count += 1
                    run_err_count += 1
                guardar_log(registros)

        ok_count = sum(1 for r in registros if str(r.get("Estado", "")).upper() == "OK")
        err_count = sum(1 for r in registros if str(r.get("Estado", "")).upper() != "OK")
        print(f"\nResultado de esta pasada: {run_ok_count} OK, {run_err_count} errores, {run_skip_count} ya OK/saltadas.")
        print(f"Log completo: {ok_count} OK, {err_count} errores.")
        try:
            browser.close()
        except Exception:
            pass

def _actualizar_registro(registros, dni, label, desde, hasta, estado, detalle):
    """Actualiza la fila existente en el log o agrega una nueva."""
    for r in registros:
        try:
            if (int(r["DNI"]) == dni and str(r["Novedad"]) == label
                    and str(r["Desde"]) == desde and str(r["Hasta"]) == hasta):
                r["Estado"]  = estado
                r["Detalle"] = detalle
                return
        except Exception:
            continue
    # Si no existe, agregar
    registros.append({
        "Nombre": "", "DNI": dni,
        "Novedad": label, "Desde": desde, "Hasta": hasta,
        "Estado": estado, "Detalle": detalle,
    })

if __name__ == "__main__":
    main()
