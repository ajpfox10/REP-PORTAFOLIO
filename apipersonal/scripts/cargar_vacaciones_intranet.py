r"""
Carga novedades SOLO_SIAP en la Intranet del Ministerio de Salud.
- Agrupa por DNI, carga todas las novedades de cada agente
- Re-login automático si la sesión expira
- Re-abre browser si se cierra
- Log en tiempo real en D:\G\comparacion\resultado_carga.xlsx
- Al re-correr salta los que ya tienen OK

Uso:
    python cargar_vacaciones_intranet.py --pass TU_CLAVE
    python cargar_vacaciones_intranet.py --test --pass TU_CLAVE   # solo primer DNI
"""

import os, sys, json, argparse, time, re
import pandas as pd
from collections import defaultdict
from pathlib import Path
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright, Error as PWError

# Forzar UTF-8 en la consola: evita que print() de '→', acentos, etc. crashee
# en CMD con codepage cp1252 (UnicodeEncodeError 'charmap').
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

EXCEL_PATH  = r"D:\G\comparacion\errores_siape.xlsx"   # fallback si no se pasa --excel
LOG_PATH    = r"D:\G\comparacion\resultado_carga.xlsx"
MAPEO_PATH  = r"C:\apps\personaldev\apifront\mapeo.asistencia.json"
URL_LOGIN   = "https://sistemas.ms.gba.gov.ar/intranet/login.php"
URL_PLANTEL = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/"
BASE_URL    = "https://sistemas.ms.gba.gov.ar"
USUARIO     = os.environ.get("INTRANET_USER", "xxxxxxx")
CHROME_PROFILE_DIR = os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")

# ── Helpers ─────────────────────────────────────────────────────────────────

def fmt_fecha(val):
    if pd.isnull(val):
        return None
    if isinstance(val, str):
        val = pd.to_datetime(val)
    return val.strftime("%d/%m/%Y")

def build_mapa_inverso():
    with open(MAPEO_PATH, encoding="utf-8") as f:
        mapeo = json.load(f)
    inverso = {}
    for key, siap_vals in mapeo.items():
        partes = key.split("-", 1)
        label = f"{partes[0]} - {partes[1]}" if len(partes) == 2 else key
        for val in siap_vals:
            if val not in inverso:
                inverso[val.upper()] = label
    return inverso

# Enfermedades SIN justificar (JUSTIFICADO=NO en SIAPE.xlsx) se cargan con esta
# opción. OJO: "JUSTIFICCIÓN" es la ortografía real del desplegable de la Intranet.
LABEL_ENF_PENDIENTE = "E - LICENCIA POR ENFERMEDAD (PENDIENTE JUSTIFICCIÓN)"

SIAPE_DIR = r"D:\G\comparacion\SIAPE"

def cargar_justificados():
    """Cruce (dni, NOVEDAD, desde, hasta) -> 'SI'/'NO' leyendo el SIAPE.xlsx original."""
    import glob
    just = {}
    for fp in glob.glob(os.path.join(SIAPE_DIR, "*.xls*")):
        if os.path.basename(fp).startswith("~$"):
            continue
        try:
            df = pd.read_excel(fp)
        except Exception as e:
            print(f"  AVISO: no se pudo leer {fp}: {e}")
            continue
        if "JUSTIFICADO" not in df.columns:
            continue
        for _, r in df.iterrows():
            try:
                dni = int(r["NRO_DOCUMENTO"])
            except Exception:
                continue
            nov   = str(r.get("NOVEDAD", "")).strip().upper()
            desde = fmt_fecha(r.get("FECHA_DESDE"))
            hasta = fmt_fecha(r.get("FECHA_HASTA"))
            if not nov or not desde:
                continue
            just[(dni, nov, desde, hasta)] = str(r.get("JUSTIFICADO", "")).strip().upper()
    return just

def cargar_filas(excel_path, test_mode=False):
    df = pd.read_excel(excel_path)
    filas = df[df["Estado"] == "SOLO_SIAP"].copy()
    if filas.empty:
        print("No hay filas SOLO_SIAP.")
        sys.exit(0)
    if test_mode:
        primer_dni = filas.iloc[0]["DNI"]
        filas = filas[filas["DNI"] == primer_dni]
    return filas.to_dict("records")

def es_medica_sin_justificar(siap):
    s = str(siap or "").strip().upper()
    return (
        s.startswith("ENFERMEDAD")
        or "ATENCION FAMILIAR ENFERMO" in s
        or "ENFERMEDAD DE FAMILIAR" in s
    )

def agrupar_por_dni(filas, mapa, justificados=None):
    grupos = defaultdict(list)
    sin_mapeo = []
    for f in filas:
        siap = str(f["Nov. SIAP"]).strip().upper()
        label = mapa.get(siap)
        if not label:
            sin_mapeo.append(f"{f['Nombre']} — {siap}")
            continue
        desde = fmt_fecha(f["Desde SIAP"])
        hasta = fmt_fecha(f["Hasta SIAP"])

        # Médicas SIN justificar (JUSTIFICADO=NO) → opción E pendiente.
        # Primero usa la columna del Excel de carga; si no existe, cruza contra el SIAPE original.
        justificado_fila = str(f.get("JUSTIFICADO", f.get("Justificado", ""))).strip().upper()
        if es_medica_sin_justificar(siap):
            try:
                dni_i = int(f["DNI"])
            except Exception:
                dni_i = None
            j = justificado_fila or (justificados.get((dni_i, siap, desde, hasta)) if justificados and dni_i is not None else None)
            if j == "NO":
                label = LABEL_ENF_PENDIENTE
                print(f"    {f['Nombre']}: {siap} sin justificar → se carga como E-PENDIENTE")

        grupos[f["DNI"]].append({
            "nombre": f["Nombre"],
            "label":  label,
            "desde":  desde,
            "hasta":  hasta,
        })
    if sin_mapeo:
        print(f"  SIN MAPEO ({len(sin_mapeo)} filas):")
        for s in sin_mapeo:
            print(f"    {s}")
    return grupos

# ── Log de resultados ────────────────────────────────────────────────────────

def log_clave(dni, label, desde, hasta):
    return f"{int(dni)}|{label}|{desde}|{hasta}"

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

def cargar_log_existente():
    """Devuelve set de claves que ya tienen estado OK."""
    ok_set = set()
    if not Path(LOG_PATH).exists():
        return ok_set, []
    try:
        df = pd.read_excel(LOG_PATH)
        for _, r in df.iterrows():
            if str(r.get("Estado", "")).upper() == "OK":
                k = log_clave(r["DNI"], r["Novedad"], r["Desde"], r["Hasta"])
                ok_set.add(k)
        return ok_set, df.to_dict("records")
    except Exception:
        return ok_set, []

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

# ── Browser / sesión ─────────────────────────────────────────────────────────

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

MAPA_DEP_CODIGO = {
    "HOSPITAL": "1701",
    "UPA 4":    "1699",
    "UPA 18":   "1826",
}

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
    """Navega a /list del agente. Re-hace login si la sesión expiró."""
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
            if "sesion_expirada" in msg or "acceso denegado" in msg.lower() or intento == 0:
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
    """Selecciona novedad, fecha y guarda. Retorna (exito, mensaje)."""
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
        # Intentar navegar de vuelta a /list para el próximo intento
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

    # Extraer mensaje de error
    try:
        msg = page.locator(".alert, .error, .alert-danger, [class*='error'], [class*='alert']").first.inner_text(timeout=2000)
        msg = msg.strip().replace("\n", " ")[:200]
    except Exception:
        msg = "sin confirmación (sin mensaje de error capturado)"

    # Volver a /list para el próximo intento dentro del mismo agente
    try:
        page.go_back()
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass

    return False, msg

# ── Main ─────────────────────────────────────────────────────────────────────

def dep_de_fila(fila):
    """Normaliza la columna Dependencia de una fila a HOSPITAL / UPA 4 / UPA 18."""
    dep = str(fila.get("Dependencia", "")).strip().upper()
    if "UPA" in dep and "18" in dep:
        return "UPA 18"
    if "UPA" in dep and "4" in dep:
        return "UPA 4"
    return "HOSPITAL"

def detectar_dependencia(filas):
    """Dependencia de la primera fila con dato (fallback si no viene --dependencia)."""
    for fila in filas:
        if str(fila.get("Dependencia", "")).strip():
            return dep_de_fila(fila)
    return "HOSPITAL"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--excel", dest="excel_path", default=None)
    parser.add_argument("--dependencia", dest="dependencia", default=None,
                        help="HOSPITAL / UPA 4 / UPA 18 — si no viene, se detecta de la primera fila")
    parser.add_argument("--log",   dest="log_path",   default=None,
                        help="Ruta del Excel de resultados (default: resultado_carga.xlsx)")
    args = parser.parse_args()

    password   = args.password or os.environ.get("INTRANET_PASS") or input("Contraseña: ")
    excel_path = args.excel_path or EXCEL_PATH
    if args.log_path:
        global LOG_PATH
        LOG_PATH = args.log_path

    mapa   = build_mapa_inverso()
    filas  = cargar_filas(excel_path, test_mode=args.test)
    justificados = cargar_justificados()
    if justificados:
        print(f"Cruce JUSTIFICADO: {len(justificados)} filas leídas de SIAPE.xlsx")
    else:
        print("AVISO: sin cruce JUSTIFICADO (no se pudo leer SIAPE.xlsx) — todo se carga con el mapeo normal")
    dependencia = (args.dependencia or detectar_dependencia(filas)).upper()
    if dependencia not in MAPA_DEP_CODIGO:
        dependencia = "HOSPITAL"
    print(f"Dependencia del run: {dependencia}")

    # SOLO filas de esta dependencia — nunca mezclar (evita 'no pertenece a su plantel')
    antes = len(filas)
    filas = [f for f in filas if dep_de_fila(f) == dependencia]
    if antes - len(filas):
        print(f"OJO: {antes - len(filas)} filas de OTRA dependencia quedaron AFUERA de este run")
    if not filas:
        print("No quedan filas para esta dependencia.")
        sys.exit(0)

    grupos = agrupar_por_dni(filas, mapa, justificados)

    ya_ok, registros = cargar_log_existente()
    if ya_ok:
        print(f"Log existente: {len(ya_ok)} novedades ya cargadas (se saltean)")

    print(f"Agentes a procesar: {len(grupos)}")

    ok_count = sum(1 for r in registros if r.get("Estado") == "OK")
    err_count = sum(1 for r in registros if r.get("Estado") != "OK")

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

            # Saltar si todas las novedades de este agente ya están OK
            pendientes = [
                nov for nov in novedades
                if log_clave(dni, nov["label"], nov["desde"], nov["hasta"]) not in ya_ok
            ]
            if not pendientes:
                print(f"[{i}/{len(grupos)}] {nombre} — ya cargado, se salta")
                continue

            print(f"[{i}/{len(grupos)}] {nombre} (DNI {int(dni)}) — {len(pendientes)} pendiente(s)")

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
                exito_nav, msg_nav = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                if not exito_nav:
                    for nov in pendientes:
                        registros.append({
                            "Nombre": nombre, "DNI": int(dni),
                            "Novedad": nov["label"],
                            "Desde": nov["desde"], "Hasta": nov["hasta"],
                            "Estado": "ERROR_NAV", "Detalle": msg_nav
                        })
                        err_count += 1
                    guardar_log(registros)
                    continue

                for nov in pendientes:
                    if not nov["desde"] or not nov["hasta"]:
                        print(f"  SKIP {nov['label']}: fechas vacías")
                        registros.append({
                            "Nombre": nombre, "DNI": int(dni),
                            "Novedad": nov["label"],
                            "Desde": nov["desde"], "Hasta": nov["hasta"],
                            "Estado": "SIN_FECHA", "Detalle": ""
                        })
                        err_count += 1
                        guardar_log(registros)
                        continue

                    print(f"  Cargando: {nov['label']} {nov['desde']} → {nov['hasta']}")

                    # Re-abrir browser si se cerró durante la carga
                    try:
                        page.title()
                    except Exception:
                        print("  Browser cerrado a mitad, reabriendo y renavegando...")
                        try:
                            browser.close()
                        except Exception:
                            pass
                        browser, page = nueva_pagina(p)
                        try:
                            login(page, password, dependencia)
                            exito_nav2, _ = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                            if not exito_nav2:
                                raise Exception("No se pudo renavegar")
                        except Exception as e:
                            print(f"  Recuperación falló: {e}")
                            registros.append({
                                "Nombre": nombre, "DNI": int(dni),
                                "Novedad": nov["label"],
                                "Desde": nov["desde"], "Hasta": nov["hasta"],
                                "Estado": "ERROR", "Detalle": "Browser cerrado, recuperación falló"
                            })
                            err_count += 1
                            guardar_log(registros)
                            continue

                    try:
                        historial_url = page.url
                        exito, msg_err = cargar_novedad(page, nov["label"], nov["desde"], nov["hasta"])
                        if exito:
                            print(f"  OK — {msg_err}" if msg_err else "  OK")
                            ok_count += 1
                            ya_ok.add(log_clave(dni, nov["label"], nov["desde"], nov["hasta"]))
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
                                    ya_ok.add(log_clave(dni, nov["label"], nov["desde"], nov["hasta"]))
                                    estado = "OK"
                                    detalle = (f"OK AJUSTADO: maximo {max_dias} dias por mes. "
                                               f"Original {nov['desde']} a {nov['hasta']}; "
                                               f"cargado {nov['desde']} a {hasta_ajustado}. {msg2 or ''}").strip()
                                else:
                                    print(f"  ERROR AJUSTE: {msg2}")
                                    err_count += 1
                                    estado = "ERROR"
                                    detalle = f"{msg_err or ''} | Ajuste {nov['desde']} a {hasta_ajustado} fallo: {msg2 or ''}"[:200]
                            else:
                                print(f"  ERROR: {msg_err}")
                                err_count += 1
                                estado, detalle = "ERROR", msg_err or ""
                    except Exception as e:
                        print(f"  EXCEPCIÓN: {e}")
                        err_count += 1
                        estado, detalle = "EXCEPCION", str(e)[:200]

                    registros.append({
                        "Nombre": nombre, "DNI": int(dni),
                        "Novedad": nov["label"],
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": estado, "Detalle": detalle
                    })
                    guardar_log(registros)

            except Exception as e:
                print(f"  EXCEPCIÓN GENERAL: {e}")
                for nov in pendientes:
                    registros.append({
                        "Nombre": nombre, "DNI": int(dni),
                        "Novedad": nov["label"],
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": "EXCEPCION", "Detalle": str(e)[:200]
                    })
                    err_count += 1
                guardar_log(registros)

        print(f"\nResultado total: {ok_count} OK, {err_count} errores.")
        print(f"Log guardado en: {LOG_PATH}")
        try:
            browser.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
