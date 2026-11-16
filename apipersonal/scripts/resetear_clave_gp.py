# Robot: resetea la clave de Gestiones Personales (Intranet del Ministerio) de los agentes que la
# pidieron por el bot de WhatsApp (tabla gp_reset_cola, la crea el API).
# Circuito (grabado el 12/11/2026, logs/grabaciones/reset_claves_20261112_163321):
#   Intranet -> Administrador de Gestiones Personales -> /usuario/ -> buscar por Nro de Documento
#   -> "- Seleccione -" -> "Resetear clave" -> modal #usuario_reset -> "Resetear Clave".
#   Por dentro va a /usuario/{id}/reset y la clave queda en el NÚMERO DE DOCUMENTO
#   (estado "DEBE INGRESAR CON LA CLAVE PROVISORIA (DOCUMENTO)").
# Si la cuenta está "A CONFIRMAR", la confirma (mismo resultado: clave provisoria = DNI).
#
# Resultados por pedido: OK · YA_PROVISORIA (ya tenía la clave = DNI) · SIN_CUENTA · ERROR · SIMULADO
# Por defecto SIMULA (busca y no toca nada). Para resetear de verdad: --resetear
# Login, perfil de Chrome y turno: igual que confirmar_usuarios_gp.py (recurso robots_intranet en run_robot.py).
#
# Uso: python resetear_clave_gp.py [--resetear] [--headless]          (procesa la cola)
#      python resetear_clave_gp.py --dni 12345678 [--resetear]          (uno suelto, sin cola)
import os, sys, json, argparse, re
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import confirmar_usuarios_gp as GP          # login, entrar_gp, filas, cerrar_sesion, cerrar_y_salir, URL_USUARIOS...
import mapeo_novedades as MN                # conn()
from playwright.sync_api import sync_playwright

LOGDIR = Path(__file__).resolve().parent.parent / "logs" / "resetear_clave_gp"
LOGDIR.mkdir(parents=True, exist_ok=True)
LOG = LOGDIR / f"{datetime.now():%Y%m%d_%H%M%S}.jsonl"

def log(**ev):
    ev["t"] = datetime.now().strftime("%H:%M:%S")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(json.dumps(ev, ensure_ascii=False), flush=True)

# ─── cola ────────────────────────────────────────────────────────────────────

def tomar_pendientes():
    """Marca PROCESANDO los pedidos pendientes reales y los devuelve."""
    cn = MN.conn()
    try:
        with cn.cursor() as cur:
            cur.execute("SELECT id, dni FROM gp_reset_cola WHERE estado = 'PENDIENTE' AND prueba = 0 ORDER BY id")
            rows = cur.fetchall()
            if rows:
                cur.execute(f"UPDATE gp_reset_cola SET estado = 'PROCESANDO' WHERE id IN ({','.join(str(int(r['id'])) for r in rows)})")
        cn.commit()
        return rows
    finally:
        cn.close()

def guardar(id_, estado, detalle):
    cn = MN.conn()
    try:
        with cn.cursor() as cur:
            cur.execute("UPDATE gp_reset_cola SET estado = %s, detalle = %s, procesado_at = NOW() WHERE id = %s",
                        (estado, (detalle or "")[:500], id_))
        cn.commit()
    finally:
        cn.close()

def devolver_a_pendiente(ids):
    """Si el robot se cae antes de procesarlos, que la próxima corrida los vuelva a tomar."""
    if not ids:
        return
    try:
        cn = MN.conn()
        with cn.cursor() as cur:
            cur.execute(f"UPDATE gp_reset_cola SET estado = 'PENDIENTE' WHERE estado = 'PROCESANDO' AND id IN ({','.join(str(int(i)) for i in ids)})")
        cn.commit(); cn.close()
    except Exception as e:
        log(kind="error_devolver", error=str(e)[:200])

# ─── Intranet ────────────────────────────────────────────────────────────────

def buscar_dni(page, dni):
    page.goto(GP.URL_USUARIOS, wait_until="domcontentloaded", timeout=60000)
    page.fill("#form_legajo", "")
    page.fill("#form_nro_doc", str(dni))
    with page.expect_navigation(timeout=60000):
        page.click("#btn_search")
    page.wait_for_load_state("domcontentloaded")
    # solo las cuentas de ese DNI (CUIL = XX + DNI de 8 + X)
    return [(i, f) for i, f in enumerate(GP.filas(page)) if re.sub(r"\D", "", f["cuil"] or "")[2:10] == str(dni).zfill(8)]

def estados_de(page, dni):
    return [f["estado"] for _, f in buscar_dni(page, dni)]

def resetear(page, dni, simular):
    cuentas = buscar_dni(page, dni)
    if not cuentas:
        return "SIN_CUENTA", "no hay cuenta de Gestiones Personales con ese DNI"
    pend = [(i, f) for i, f in cuentas if GP.EST_PEND in f["estado"].upper()]
    if pend:
        # cuenta sin confirmar: confirmarla deja la clave = DNI
        _, f = pend[0]
        r, det, _ = GP.confirmar(page, f["legajo"], f["cuil"], simular)
        if r == "OK":
            GP.anotar_aviso(f)
        return {"OK": "OK", "SIMULADO": "SIMULADO", "SALTEADO": "YA_PROVISORIA"}.get(r, "ERROR"), f"cuenta A CONFIRMAR: {det}"
    activas = [(i, f) for i, f in cuentas if "ANULAD" not in f["estado"].upper()]
    if not activas:
        return "SIN_CUENTA", "solo tiene cuentas anuladas: " + " / ".join(f["estado"] for _, f in cuentas)
    if len(activas) > 1:
        return "ERROR", f"tiene {len(activas)} cuentas activas: " + " / ".join(f["estado"] for _, f in activas)
    idx, f = activas[0]
    fila = page.locator("table tr").filter(has=page.locator("td")).nth(idx)
    link = fila.locator(".btn-resetear-link").first
    if link.count() == 0:
        return "ERROR", f"no aparece 'Resetear clave' (estado: {f['estado']})"
    if simular:
        return "SIMULADO", f"se resetearía (estado actual: {f['estado']})"
    fila.locator(".dropdown-toggle").first.click()
    link.click()
    page.wait_for_selector("#usuario_reset .btn-resetear", state="visible", timeout=10000)
    with page.expect_navigation(timeout=60000):
        page.click("#usuario_reset .btn-resetear")
    page.wait_for_load_state("domcontentloaded")
    est = estados_de(page, dni)
    if any(GP.EST_OK in e.upper() for e in est):
        return "OK", " / ".join(est)
    return "ERROR", "después de resetear el estado quedó: " + " / ".join(est)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resetear", action="store_true", help="resetea de verdad (sin esto, simula)")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--dni", type=int, default=0, help="un DNI suelto (no usa la cola)")
    a = ap.parse_args()
    simular = not a.resetear
    # resguardo: de verdad solo contra la base de prod (los scripts de dev leen personalv5_dev)
    if not simular and os.environ.get("DB_NAME", "").strip() != "personalv5":
        print(f"Base {os.environ.get('DB_NAME')!r} no es la de prod: SIMULO aunque pidan --resetear.", flush=True)
        simular = True

    pedidos = [{"id": None, "dni": a.dni}] if a.dni else tomar_pendientes()
    log(kind="inicio", simular=simular, pedidos=len(pedidos))
    if not pedidos:
        print("Sin pedidos de reseteo pendientes.", flush=True)
        return 0
    res, pendientes_ids = {}, [p["id"] for p in pedidos if p["id"]]
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(GP.PERFIL, channel="chrome", headless=a.headless,
                                                   no_viewport=True, args=["--start-maximized"])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.on("dialog", lambda d: (log(kind="dialog", message=d.message), d.accept()))
        try:
            GP.login(page)
            try:
                GP.entrar_gp(page)
            except Exception as e:
                log(kind="reintento_login", motivo=str(e)[:200])
                GP.cerrar_sesion(page); GP.login(page); GP.entrar_gp(page)
            for ped in pedidos:
                try:
                    r, det = resetear(page, ped["dni"], simular)
                except Exception as e:
                    r, det = "ERROR", str(e)[:300]
                res[r] = res.get(r, 0) + 1
                if ped["id"]:
                    guardar(ped["id"], r, det)
                    pendientes_ids.remove(ped["id"])
                log(kind="pedido", id=ped["id"], dni=ped["dni"], resultado=r, detalle=det)
        except Exception as e:
            log(kind="error_fatal", error=str(e)[:300])
            devolver_a_pendiente(pendientes_ids)
            GP.cerrar_y_salir(ctx, 1)
        log(kind="fin", resumen=res)
        # última línea = motivo en la página Robots
        print(f"Pedidos {sum(res.values())}: reseteados {res.get('OK', 0)}, ya tenían clave provisoria {res.get('YA_PROVISORIA', 0)}, "
              f"sin cuenta {res.get('SIN_CUENTA', 0)}, simulados {res.get('SIMULADO', 0)}, errores {res.get('ERROR', 0)}", flush=True)
        GP.cerrar_y_salir(ctx, 1 if res.get("ERROR") else 0)

if __name__ == "__main__":
    sys.exit(main() or 0)
