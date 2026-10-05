"""
Carga de AUSENTES 2.0 en la Intranet (copia de cargar_ausentes_intranet.py, que queda como
version vieja: la de los botones rojos "Ausentes ..." del comparador).

Diferencias con la vieja:
- No lee el SIAPE directo (la vieja pedia SIAPE.xlsx y hoy el archivo es SIAPE.XLS -> no arrancaba):
  toma los ausentes de la ultima corrida del Comparador 2.0 (comparacion_novedades), que ya los
  compara contra el art. 28 del Ministerio: AUSENTE SIN AVISO, JUSTIFICADO = NO, estado SOLO_SIAP
  (o sea, que el Ministerio todavia no tiene), de la dependencia del run.
- El resultado de cada ausente va a la tabla novedades_carga_intranet (la misma de la carga de
  novedades 2.0), no a resultado_carga_ausentes*.xlsx. Los OK no se reintentan.
- Registra la corrida en la pagina Robots como intranet_carga_ausentes_v2_<dep>.
La carga en si (opcion 28 - INASISTENCIA, control de "ya cargada", superposicion) es la misma.

Uso:
  python cargar_ausentes_intranet_v2.py --dependencia HOSPITAL
  python cargar_ausentes_intranet_v2.py --dependencia "UPA 4" --solo-cola   # lista, no carga
  python cargar_ausentes_intranet_v2.py --dependencia "UPA 18" --test      # solo el 1er DNI
"""

import argparse
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd
from playwright.sync_api import sync_playwright

# detalle por agente para la pagina Robots (script_run_items)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapeo_novedades as MN
import post_carga
from cargar_novedades_intranet_v2 import TABLA_CARGA, crear_tabla_carga
SCRIPT_ID = None   # lo fija main(): intranet_carga_ausentes_v2_<dep>
NOVEDAD_SIAP = "AUSENTE SIN AVISO"

USUARIO = os.environ.get("INTRANET_USER", "xxxxxxx")
CHROME_PROFILE_DIR = os.environ.get("INTRANET_CHROME_PROFILE", r"D:\G\comparacion\intranet_chrome_profile")
BASE_URL = "https://sistemas.ms.gba.gov.ar"
URL_LOGIN = "https://sistemas.ms.gba.gov.ar/intranet/login.php"
URL_PLANTEL = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/"


MAPA_DEP_CODIGO = {
    "HOSPITAL": "1701",
    "UPA 4": "1699",
    "UPA 18": "1826",
}

SUFIJOS_EXCEL = {
    "HOSPITAL": "",
    "UPA 4": "_upa4",
    "UPA 18": "_upa18",
}

AUSENTE_LABEL_CANDIDATOS = [
    "28 - INASISTENCIA",
    "28-INASISTENCIA",
    "AUSENTE SIN AVISO",
    "AUSENTE",
]


def _sin_acentos(s):
    import unicodedata

    return unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().upper()


def norm_dni(v):
    s = re.sub(r"\D+", "", str(v or ""))
    return s


def norm_text(v):
    return _sin_acentos(v).strip()


def fmt_fecha(val):
    if pd.isnull(val):
        return None
    if isinstance(val, datetime):
        return val.strftime("%d/%m/%Y")
    if hasattr(val, "strftime"):
        return val.strftime("%d/%m/%Y")
    s = str(val).strip()
    if not s:
        return None
    dt = pd.to_datetime(s, dayfirst=True, errors="coerce")
    if pd.isnull(dt):
        return None
    return dt.strftime("%d/%m/%Y")


def dep_de_e5_e6(e5raw, e6raw):
    e6 = norm_text(e6raw)
    e5 = norm_text(e5raw)
    upa_e6 = re.search(r"UPA\s*(\d+)", e6) or re.search(r"UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)", e6)
    if upa_e6:
        return f"UPA {upa_e6.group(1)}"
    upa_e5 = re.search(r"UPA\s*(\d+)", e5) or re.search(r"UNIDAD\s+PRONTA\s+ATEN[A-Z]*\s+(\d+)", e5)
    if upa_e5:
        return f"UPA {upa_e5.group(1)}"
    return "HOSPITAL"


def cargar_filas_db(dependencia, test_mode=False):
    """Ausentes pendientes de la ULTIMA corrida del Comparador 2.0 para esta dependencia.
    Los registra en novedades_carga_intranet (sin pisar los OK) y devuelve los que no estan OK."""
    with MN.conn() as cn, cn.cursor() as cur:
        crear_tabla_carga(cur)
        cur.execute("SELECT MAX(id) AS id FROM comparacion_corridas")
        corrida = (cur.fetchone() or {}).get("id")
        if not corrida:
            return None, []
        cur.execute(f"""
            INSERT INTO {TABLA_CARGA}
              (dependencia, dni, nombre, novedad_siap, desde, hasta, justificado, motivo_comparacion, corrida_id)
            SELECT dependencia, dni, nombre, novedad_siap, desde_siap, COALESCE(hasta_siap, desde_siap),
                   justificado_siap, motivo, corrida_id
              FROM comparacion_novedades
             WHERE corrida_id = %s AND estado = 'SOLO_SIAP' AND novedad_siap = %s
               AND justificado_siap = 'NO' AND dependencia = %s AND dni <> '' AND desde_siap IS NOT NULL
            ON DUPLICATE KEY UPDATE
              corrida_id = VALUES(corrida_id), dependencia = VALUES(dependencia), nombre = VALUES(nombre),
              justificado = VALUES(justificado), motivo_comparacion = VALUES(motivo_comparacion)""",
            (corrida, NOVEDAD_SIAP, dependencia))
        cn.commit()
        cur.execute(f"""
            SELECT dni, nombre, novedad_siap, justificado, desde, hasta, dependencia
              FROM {TABLA_CARGA}
             WHERE corrida_id = %s AND dependencia = %s AND novedad_siap = %s AND estado <> 'OK'
             ORDER BY nombre, desde""", (corrida, dependencia, NOVEDAD_SIAP))
        filas = [{
            "Nombre": r["nombre"] or r["dni"], "DNI": int(r["dni"]),
            "Novedad SIAPE": r["novedad_siap"], "Justificado": r["justificado"],
            "Desde": fmt_fecha(r["desde"]), "Hasta": fmt_fecha(r["hasta"]) or fmt_fecha(r["desde"]),
            "Dependencia": r["dependencia"],
        } for r in cur.fetchall()]
    if test_mode and filas:
        filas = [f for f in filas if f["DNI"] == filas[0]["DNI"]]
    return corrida, filas


def agrupar_por_dni(filas):
    grupos = defaultdict(list)
    for f in filas:
        grupos[f["DNI"]].append({
            "nombre": f["Nombre"],
            "label": None,
            "desde": f["Desde"],
            "hasta": f["Hasta"],
        })
    return grupos


_GUARDADOS = {"n": 0}


def guardar_log(registros, _log_path=None):
    """2.0: el resultado de cada ausente nuevo de `registros` va a novedades_carga_intranet."""
    nuevos = registros[_GUARDADOS["n"]:]
    try:
        with MN.conn() as cn, cn.cursor() as cur:
            for r in nuevos:
                try:
                    desde = datetime.strptime(str(r["Desde"]), "%d/%m/%Y").strftime("%Y-%m-%d")
                    hasta = datetime.strptime(str(r["Hasta"]), "%d/%m/%Y").strftime("%Y-%m-%d")
                except Exception:
                    continue
                ok = str(r.get("Estado", "")).upper() == "OK"
                cur.execute(f"""
                    UPDATE {TABLA_CARGA}
                       SET estado = %s, label_intranet = %s, detalle = %s, intentos = intentos + 1,
                           cargado_en = IF(%s, NOW(), cargado_en)
                     WHERE dni = %s AND novedad_siap = %s AND desde = %s AND hasta = %s""",
                    (str(r.get("Estado", ""))[:20], str(r.get("Novedad") or "")[:200],
                     str(r.get("Detalle") or "")[:500] or None, ok,
                     str(int(r["DNI"])), NOVEDAD_SIAP, desde, hasta))
            cn.commit()
        _GUARDADOS["n"] = len(registros)
    except Exception as e:
        print(f"  AVISO: no pude anotar el resultado en {TABLA_CARGA}: {e}")
    if SCRIPT_ID:
        MN.items_desde_registros(SCRIPT_ID, registros)


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


def log_clave(dni, desde, hasta):
    return f"{int(dni)}|{desde}|{hasta}"


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
        content = page.content().lower()
        return "acceso denegado" in content or "no tiene permisos" in content
    except Exception:
        return False


def error_visible(page):
    try:
        loc = page.locator(".alert-danger").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("x ").strip()
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


def exito_visible(page):
    try:
        loc = page.locator(".alert-success").first
        if loc.count() > 0 and loc.is_visible():
            txt = loc.inner_text(timeout=1500).strip().replace("\n", " ")
            txt = txt.lstrip("x ").strip()
            if txt:
                return txt[:200]
    except Exception:
        pass
    return None


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
        print("  Sesion ya activa, no hace falta re-login")
    page.wait_for_selector("text=Parte de Novedades", timeout=180000)
    page.click("text=Parte de Novedades")
    page.wait_for_load_state("networkidle", timeout=20000)
    cambiar_dependencia(page, dependencia)


def cambiar_dependencia(page, dependencia):
    codigo = MAPA_DEP_CODIGO.get(dependencia.upper(), "1701")

    try:
        if f"({codigo})" in page.content():
            print(f"  Ya en dependencia {dependencia} ({codigo})")
            return
    except Exception:
        pass

    try:
        for sel in [f"a.dropdown-toggle:has-text('{USUARIO}')", f".dropdown-toggle:has-text('{USUARIO}')", f"a:has-text('{USUARIO}')"]:
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
        if resultado != "OK":
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

    raise Exception(f"NO se pudo cambiar la dependencia a {dependencia} ({codigo}) - se aborta para no cargar en la dependencia equivocada")


def ir_a_novedades(page, dni, password, dependencia="HOSPITAL", nombre=None):
    for _ in range(2):
        try:
            page.goto(URL_PLANTEL, wait_until="domcontentloaded", timeout=20000)
            page.wait_for_selector("input:not([type=hidden])", timeout=10000)
            if is_session_expired(page):
                raise Exception("sesion_expirada")
            page.wait_for_timeout(400)

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
                return False, "No se encontro el campo Nro Documento en Buscar Personal"
            campo_dni = page.locator("[data-pw-dni='1']")
            campo_dni.click()
            campo_dni.fill(str(int(dni)))
            page.get_by_role("button", name="Buscar").click()
            page.wait_for_load_state("networkidle", timeout=15000)

            msg_pag = error_visible(page)
            if msg_pag:
                return False, msg_pag

            page.wait_for_selector("table tbody tr", timeout=10000)
            res_js = page.evaluate("""() => {
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
                }
                if (!cols.length) return { error: 'No se encontro la tabla del plantel' };
                if (rows.length === 0) return { error: 'Sin filas en el plantel' };
                const idxParte = cols.findIndex(c => c.includes('parte'));
                const idxBaja = cols.findIndex(c => c.includes('baja'));
                const idxNom = cols.findIndex(c => c.includes('apellido'));
                const celda = (tr, i) => { const t = tr.querySelectorAll('td'); return (i >= 0 && t[i]) ? (t[i].textContent || '').trim() : ''; };
                const activos = rows.filter(tr => {
                    const baja = celda(tr, idxBaja);
                    const activa = baja === '' || baja.includes('0---');
                    return activa && !celda(tr, idxParte).toUpperCase().includes('HORAS CATEDRA');
                });
                if (activos.length === 0) return { error: 'Sin fila valida: todas con baja o HORAS CATEDRA' };
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
            href = res_js.get("href") if isinstance(res_js, dict) else None
            if not href:
                motivo = res_js.get("error") if isinstance(res_js, dict) else None
                return False, motivo or "No se encontro link Novedades"
            print(f"  Fila plantel elegida: {res_js.get('nombre','?')} | {res_js.get('parte','?')}")
            page.goto(f"{BASE_URL}{href}", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_load_state("networkidle", timeout=15000)
            return True, None
        except Exception as e:
            if "sesion_expirada" in str(e).lower():
                login(page, password, dependencia)
                continue
            return False, str(e)[:200]
    return False, "No se pudo navegar tras re-login"


def novedad_ya_cargada(page, desde, hasta):
    try:
        return bool(page.evaluate("""(args) => {
            const [desde, hasta] = args;
            const norm = s => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
            for (const table of Array.from(document.querySelectorAll('table'))) {
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
                const iCod = ths.findIndex(h => h.includes('novedad'));
                const iDesde = ths.findIndex(h => h.includes('desde'));
                const iHasta = ths.findIndex(h => h.includes('hasta'));
                const iElim = ths.findIndex(h => h.includes('elimin'));
                for (const tr of dataRows) {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
                    const cod = norm(tds[iCod] || '');
                    const elim = iElim >= 0 ? norm(tds[iElim] || '') : 'NO';
                    const esAusente = cod.includes('INASISTENCIA') || cod.includes('AUSENTE');
                    if (esAusente && tds[iDesde] === desde && tds[iHasta] === hasta && !elim.startsWith('S')) return true;
                }
            }
            return false;
        }""", [str(desde), str(hasta)]))
    except Exception:
        return False


def cargar_novedad(page, desde, hasta, label_override=None):
    try:
        select_nov = page.locator("select[id*='personalnovedadtype'], select[name*='personalnovedadtype']").first
        try:
            select_nov.wait_for(timeout=4000)
        except Exception:
            select_nov = page.locator("select").filter(has_text="Seleccione").first
            select_nov.wait_for(timeout=6000)

        opciones = select_nov.evaluate("el => Array.from(el.options).map(o => o.text.trim()).filter(Boolean)")
        candidatos = [label_override] if label_override else []
        candidatos.extend(AUSENTE_LABEL_CANDIDATOS)
        candidatos_n = [norm_text(c) for c in candidatos if c]

        real = None
        opciones_n = [(op, norm_text(op)) for op in opciones]
        for cand in candidatos_n:
            real = next((op for op, opn in opciones_n if opn == cand), None)
            if real:
                break
        if real is None:
            real = next((op for op, opn in opciones_n if "INASISTENCIA" in opn), None)
        if real is None:
            real = next((op for op, opn in opciones_n if "AUSENTE" in opn), None)
        if real is None:
            return False, "No se encontro opcion de ausente/inasistencia en el desplegable", ""

        select_nov.select_option(label=real)
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Continuar").click()
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        msg_pag = error_visible(page)
        try:
            page.go_back()
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        return False, msg_pag or f"Error al seleccionar: {e}", ""

    try:
        sel_desde = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaDesde"
        sel_hasta = "#minsaludba_partenovedadesbundle_personalnovedadtype_fechaHasta"
        try:
            page.wait_for_selector(sel_desde, state="attached", timeout=8000)
        except Exception:
            msg_pag = error_visible(page)
            try:
                page.go_back()
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            return False, msg_pag or "No aparecio el formulario de fechas", real

        campo_desde = page.locator(sel_desde)
        campo_hasta = page.locator(sel_hasta)
        campo_desde.click()
        campo_desde.press_sequentially(desde, delay=80)
        page.wait_for_timeout(300)
        campo_hasta.click()
        campo_hasta.press_sequentially(hasta, delay=80)
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Guardar").click()
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception as e:
        return False, f"Error al guardar: {e}", real

    ok_msg = exito_visible(page)
    if ok_msg:
        return True, ok_msg, real
    if "correctamente" in page.content().lower():
        return True, "Guardado correctamente", real

    try:
        msg = page.locator(".alert, .error, .alert-danger, [class*='error'], [class*='alert']").first.inner_text(timeout=2000)
        msg = msg.strip().replace("\n", " ")[:200]
    except Exception:
        msg = "sin confirmacion (sin mensaje de error capturado)"
    return False, msg, real


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--pass", dest="password")
    parser.add_argument("--dependencia", dest="dependencia", default="HOSPITAL")
    parser.add_argument("--solo-cola", action="store_true",
                        help="arma y lista los ausentes pendientes desde la base, sin abrir la Intranet")
    parser.add_argument("--label", dest="label", default=os.environ.get("INTRANET_AUSENTE_LABEL"))
    args = parser.parse_args()

    password = args.password or os.environ.get("INTRANET_PASS") or input("Contrasena: ")
    dependencia = args.dependencia.upper().replace("UPA4", "UPA 4").replace("UPA18", "UPA 18")
    if dependencia not in MAPA_DEP_CODIGO:
        print(f"ERROR: dependencia invalida '{args.dependencia}' (HOSPITAL / UPA 4 / UPA 18)")
        return
    global SCRIPT_ID
    SCRIPT_ID = f"intranet_carga_ausentes_v2_{MN.sufijo_dep(dependencia)}"
    script_desc = f"Carga de ausentes 2.0 en Intranet MS ({dependencia})"
    t0 = time.time()
    log_path = None

    corrida, filas = cargar_filas_db(dependencia, test_mode=args.test)
    if corrida is None:
        print("No hay corridas del Comparador 2.0 todavia.")
        MN.registrar_run(SCRIPT_ID, script_desc, "error", motivo="No hay corridas del Comparador 2.0")
        return
    print(f"Comparador 2.0 corrida {corrida}: {len(filas)} ausente(s) pendiente(s) para {dependencia}")
    if args.solo_cola:
        for f in filas:
            print(f"  {f['DNI']}  {f['Nombre']}  {f['Desde']} -> {f['Hasta']}")
        return
    if not filas:
        print(f"No hay AUSENTE SIN AVISO / JUSTIFICADO=NO pendientes para {dependencia}.")
        MN.registrar_run(SCRIPT_ID, script_desc, "ok", motivo=f"Sin ausentes pendientes (corrida {corrida})",
                         filas=0, duracion_seg=int(time.time() - t0))
        return

    grupos = agrupar_por_dni(filas)
    ya_ok, registros = set(), []   # 2.0: los OK ya quedaron afuera en cargar_filas_db
    MN.items_desde_registros(SCRIPT_ID, registros, inicio=0)

    print(f"Dependencia del run: {dependencia}")
    print(f"Filas ausentes: {len(filas)}")
    print(f"Agentes a procesar: {len(grupos)}")
    if args.label:
        print(f"Etiqueta preferida: {args.label}")

    ok_count = sum(1 for r in registros if r.get("Estado") == "OK")
    err_count = sum(1 for r in registros if r.get("Estado") != "OK")

    with sync_playwright() as p:
        browser, page = nueva_pagina(p)
        print("Iniciando sesion...")
        try:
            login(page, password, dependencia)
        except Exception as e:
            print(f"ERROR en login/cambio dependencia: {e}")
            browser.close()
            MN.registrar_run(SCRIPT_ID, script_desc, "error", motivo=f"Login/dependencia: {e}"[:480],
                             archivo=TABLA_CARGA, duracion_seg=int(time.time() - t0))
            return
        print("Sesion iniciada.\n")

        for i, (dni, novedades) in enumerate(grupos.items(), 1):
            nombre = novedades[0]["nombre"]
            pendientes = [nov for nov in novedades if log_clave(dni, nov["desde"], nov["hasta"]) not in ya_ok]
            if not pendientes:
                print(f"[{i}/{len(grupos)}] {nombre} - ya cargado, se salta")
                continue

            print(f"[{i}/{len(grupos)}] {nombre} (DNI {int(dni)}) - {len(pendientes)} pendiente(s)")
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
                    print(f"  Re-login fallo: {e}")
                    break

            exito_nav, msg_nav = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
            if not exito_nav:
                for nov in pendientes:
                    registros.append({
                        "Nombre": nombre, "DNI": int(dni), "Novedad": "AUSENTE",
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": "ERROR_NAV", "Detalle": msg_nav,
                    })
                    err_count += 1
                guardar_log(registros, log_path)
                continue

            for nov in pendientes:
                if novedad_ya_cargada(page, nov["desde"], nov["hasta"]):
                    print(f"  Ya estaba cargada: {nov['desde']} - {nov['hasta']}")
                    ya_ok.add(log_clave(dni, nov["desde"], nov["hasta"]))
                    registros.append({
                        "Nombre": nombre, "DNI": int(dni), "Novedad": "AUSENTE",
                        "Desde": nov["desde"], "Hasta": nov["hasta"],
                        "Estado": "OK", "Detalle": "Ya estaba cargada en la Intranet",
                    })
                    guardar_log(registros, log_path)
                    continue

                print(f"  Cargando ausente: {nov['desde']} -> {nov['hasta']}")
                try:
                    historial_url = page.url
                    exito, msg, real_label = cargar_novedad(page, nov["desde"], nov["hasta"], args.label)
                    if exito:
                        ok_count += 1
                        ya_ok.add(log_clave(dni, nov["desde"], nov["hasta"]))
                        estado = "OK"
                        detalle = msg or ""
                        print(f"  OK - opcion: {real_label}")
                    else:
                        if es_error_superposicion(msg):
                            msg = detalle_superposicion(page, real_label or args.label or "AUSENTE", nov["desde"], nov["hasta"], msg, historial_url)
                        err_count += 1
                        estado = "ERROR"
                        detalle = msg or ""
                        print(f"  ERROR: {detalle}")
                except Exception as e:
                    err_count += 1
                    real_label = "AUSENTE"
                    estado = "EXCEPCION"
                    detalle = str(e)[:200]
                    print(f"  EXCEPCION: {detalle}")

                registros.append({
                    "Nombre": nombre, "DNI": int(dni), "Novedad": real_label or "AUSENTE",
                    "Desde": nov["desde"], "Hasta": nov["hasta"],
                    "Estado": estado, "Detalle": detalle,
                })
                guardar_log(registros, log_path)

                try:
                    exito_nav2, _ = ir_a_novedades(page, dni, password, dependencia, nombre=nombre)
                    if not exito_nav2:
                        break
                except Exception:
                    break

        print(f"\nResultado total: {ok_count} OK, {err_count} errores.")
        print(f"Resultado anotado en la tabla {TABLA_CARGA}")
        MN.registrar_run(SCRIPT_ID, script_desc, "ok",
                         motivo=f"Corrida {corrida}: {ok_count} ausentes cargados OK · {err_count} con error",
                         filas=ok_count, archivo=TABLA_CARGA, duracion_seg=int(time.time() - t0))
        try:
            browser.close()
        except Exception:
            pass

    # navegador ya cerrado: archivo del Ministerio nuevo + comparacion contra SIAPE
    post_carga.actualizar_ministerio_y_comparar(dependencia, ok_count)


if __name__ == "__main__":
    main()
