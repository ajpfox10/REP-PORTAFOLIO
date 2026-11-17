"""
Agenda de turnos <-> Google Calendar (mig 123). Cuenta de antecedentes, mismo cliente OAuth que el
robot de Gmail (gmail_antecedentes_credentials.json) pero con su propio token y permiso de calendario.

Cada corrida (cada 5 min, por run_robot.py):
  1. Crea un calendario "Turnos - <agenda>" para cada agenda activa que no tenga (agendas.gcal_calendar_id).
  2. SUBE los turnos con gcal_pendiente = 1: alta/cambio -> crea o actualiza el evento; CANCELADO -> lo borra.
     El sistema manda: si alguien mueve o borra en Google un evento del sistema, se vuelve a poner como está en la base.
  3. BAJA todos los eventos de esos calendarios a gcal_eventos (syncToken incremental). Los que se cargaron
     A MANO en Google (origen MANUAL) ocupan el horario: la agenda ya no ofrece ese horario a los agentes.

La primera vez hay que autorizar a mano (abre el navegador, se entra con la cuenta y se acepta):
  python google_calendar_turnos.py --autorizar
Otras opciones: --dry-run (no escribe en Google ni en la base).
"""
import argparse
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mapeo_novedades as MN  # conn() + .env

try:  # títulos de Google con tildes/emojis: que no rompa la consola de Windows
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

AQUI = Path(__file__).resolve().parent
CREDENCIALES = AQUI / "gmail_antecedentes_credentials.json"   # mismo cliente OAuth (App de escritorio)
TOKEN = AQUI / "google_calendar_token.json"
SCOPES = ["https://www.googleapis.com/auth/calendar"]           # crear calendarios + eventos
TZ = "America/Argentina/Buenos_Aires"
AR = timezone(timedelta(hours=-3))                              # Argentina sin horario de verano
PROP = "agenda_turno_id"                                        # marca de los eventos que sube el sistema
PIE = "\n\n— Cargado por el sistema de Personal (Agenda de turnos). Los cambios se hacen desde el sistema."


def credenciales(interactivo=False):
    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif interactivo:
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENCIALES), SCOPES)
        creds = flow.run_local_server(port=0, open_browser=True,
                                      authorization_prompt_message="Abri este link si no se abrio solo el navegador:\n{url}\n")
    else:
        raise RuntimeError("Google Calendar sin autorizar: correr 'python google_calendar_turnos.py --autorizar' y aceptar en el navegador")
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def servicio(interactivo=False):
    return build("calendar", "v3", credentials=credenciales(interactivo), cache_discovery=False)


def tc(s):
    return " ".join(w.capitalize() for w in str(s or "").split())


def a_local(valor):
    """dateTime o date de Google -> datetime naive en hora argentina."""
    if not valor:
        return None
    if "dateTime" in valor:
        dt = datetime.fromisoformat(valor["dateTime"].replace("Z", "+00:00"))
        return dt.astimezone(AR).replace(tzinfo=None)
    if "date" in valor:
        return datetime.fromisoformat(valor["date"])
    return None


def es_404(e):
    return isinstance(e, HttpError) and e.resp.status in (404, 410)


# ── 1. Calendarios ─────────────────────────────────────────────────────────────

def asegurar_calendarios(svc, cur, dry):
    cur.execute("SELECT id, nombre FROM agendas WHERE activa = 1 AND gcal_calendar_id IS NULL")
    creados = 0
    for a in cur.fetchall():
        nombre = f"Turnos - {a['nombre']}"
        print(f"  Calendario nuevo: {nombre}")
        if dry:
            continue
        cal = svc.calendars().insert(body={"summary": nombre, "timeZone": TZ,
                                           "description": "Agenda de turnos del sistema de Personal"}).execute()
        cur.execute("UPDATE agendas SET gcal_calendar_id = %s WHERE id = %s", (cal["id"], a["id"]))
        # los turnos que ya había se suben a este calendario
        cur.execute("UPDATE agenda_turnos SET gcal_pendiente = 1, gcal_event_id = NULL WHERE agenda_id = %s", (a["id"],))
        creados += 1
    return creados


def calendario_perdido(cur, agenda_id, cal_id):
    """Borraron el calendario en Google: se vuelve a crear en la próxima corrida y se resube todo."""
    print(f"  AVISO: el calendario de la agenda {agenda_id} ya no existe en Google; se vuelve a crear")
    cur.execute("UPDATE agendas SET gcal_calendar_id = NULL WHERE id = %s", (agenda_id,))
    cur.execute("UPDATE agenda_turnos SET gcal_pendiente = 1, gcal_event_id = NULL WHERE agenda_id = %s", (agenda_id,))
    cur.execute("DELETE FROM gcal_eventos WHERE calendar_id = %s", (cal_id,))
    cur.execute("DELETE FROM gcal_sync WHERE calendar_id = %s", (cal_id,))


# ── 2. Subir turnos ────────────────────────────────────────────────────────────

SQL_PENDIENTES = """
  SELECT t.id, t.agenda_id, t.dni, t.estado, t.origen, t.telefono_contacto, t.observaciones, t.gcal_event_id, t.motivo,
         DATE_FORMAT(t.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(t.hora, '%H:%i') AS hora,
         a.nombre AS agenda, a.lugar, a.gcal_calendar_id AS cal,
         p.apellido, p.nombre,
         COALESCE((SELECT f.duracion_min FROM agenda_franjas f
                    WHERE f.agenda_id = t.agenda_id AND f.dia_semana = DAYOFWEEK(t.fecha) - 1
                      AND t.hora >= f.hora_desde AND t.hora < f.hora_hasta LIMIT 1), 20) AS duracion
    FROM agenda_turnos t
    JOIN agendas a ON a.id = t.agenda_id
    JOIN personal p ON p.dni = t.dni
   WHERE t.gcal_pendiente = 1 AND a.gcal_calendar_id IS NOT NULL
   ORDER BY t.id
   LIMIT 300"""


def cuerpo_evento(t):
    ini = datetime.fromisoformat(f"{t['fecha']}T{t['hora']}")
    fin = ini + timedelta(minutes=int(t["duracion"] or 20))
    pref = {"ATENDIDO": "✔ ", "AUSENTE": "✖ AUSENTE · "}.get(t["estado"], "")
    desc = [f"DNI {t['dni']}", f"Motivo: {t.get('motivo') or '-'}", f"Agenda: {t['agenda']}",
            "Pedido por el agente desde el enlace" if t["origen"] == "ENLACE" else "Cargado en la oficina"]
    if t.get("telefono_contacto"):
        desc.append(f"Tel.: {t['telefono_contacto']}")
    if t.get("observaciones"):
        desc.append(f"Obs.: {t['observaciones']}")
    return {
        "summary": (f"{pref}{str(t['apellido'] or '').upper()} {tc(t['nombre'])}".strip()
                    + (f" · {t['motivo']}" if t.get("motivo") else "")),
        "description": "\n".join(desc) + PIE,
        "location": t.get("lugar") or None,
        "start": {"dateTime": ini.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": TZ},
        "end": {"dateTime": fin.strftime("%Y-%m-%dT%H:%M:00"), "timeZone": TZ},
        "extendedProperties": {"private": {PROP: str(t["id"])}},
        "reminders": {"useDefault": True},
    }


def subir(svc, cur, dry):
    cur.execute(SQL_PENDIENTES)
    filas = cur.fetchall()
    hechos = errores = 0
    perdidos = set()
    for t in filas:
        if t["agenda_id"] in perdidos:
            continue
        try:
            if t["estado"] == "CANCELADO":
                if t["gcal_event_id"] and not dry:
                    try:
                        svc.events().delete(calendarId=t["cal"], eventId=t["gcal_event_id"]).execute()
                    except HttpError as e:
                        if not es_404(e):
                            raise
                ev_id = t["gcal_event_id"]
                accion = "borrado"
            else:
                body = cuerpo_evento(t)
                ev_id = t["gcal_event_id"]
                if dry:
                    accion = "subiría"
                elif ev_id:
                    try:
                        svc.events().update(calendarId=t["cal"], eventId=ev_id, body=body).execute()
                        accion = "actualizado"
                    except HttpError as e:
                        if not es_404(e):
                            raise
                        ev_id = None
                if not dry and not ev_id:
                    ev_id = svc.events().insert(calendarId=t["cal"], body=body).execute()["id"]
                    accion = "creado"
            print(f"  Turno {t['id']} {t['fecha']} {t['hora']} {t['apellido']}: {accion}")
            if not dry:
                cur.execute("UPDATE agenda_turnos SET gcal_event_id = %s, gcal_pendiente = 0, gcal_error = NULL WHERE id = %s",
                            (ev_id, t["id"]))
            hechos += 1
        except HttpError as e:
            if e.resp.status == 404 and not dry:
                try:
                    svc.calendars().get(calendarId=t["cal"]).execute()
                except HttpError as e2:
                    if e2.resp.status == 404:
                        calendario_perdido(cur, t["agenda_id"], t["cal"])
                        perdidos.add(t["agenda_id"])
                        continue
            errores += 1
            print(f"  ERROR turno {t['id']}: {e}")
            if not dry:
                cur.execute("UPDATE agenda_turnos SET gcal_error = %s WHERE id = %s", (str(e)[:300], t["id"]))
    return hechos, errores


# ── 3. Bajar eventos ───────────────────────────────────────────────────────────

def dni_de(cur, texto, cache):
    for d in re.findall(r"(?<!\d)(\d{7,8})(?!\d)", texto or ""):
        n = int(d)
        if n not in cache:
            cur.execute("SELECT 1 FROM personal WHERE dni = %s", (n,))
            cache[n] = bool(cur.fetchone())
        if cache[n]:
            return n
    return None


def guardar_evento(cur, cal_id, agenda_id, ev, cache, a_resubir):
    priv = (ev.get("extendedProperties") or {}).get("private") or {}
    turno_id = int(priv[PROP]) if str(priv.get(PROP, "")).isdigit() else None
    origen = "SISTEMA" if turno_id else "MANUAL"
    estado = ev.get("status", "confirmed")
    ini, fin = a_local(ev.get("start")), a_local(ev.get("end"))
    todo_el_dia = 1 if (ev.get("start") or {}).get("date") else 0
    titulo, desc = ev.get("summary"), ev.get("description")
    dni = None if turno_id else dni_de(cur, f"{titulo or ''} {desc or ''}", cache)
    upd = ev.get("updated")
    upd = datetime.fromisoformat(upd.replace("Z", "+00:00")).astimezone(AR).replace(tzinfo=None) if upd else None
    cur.execute(
        """INSERT INTO gcal_eventos (calendar_id, event_id, agenda_id, origen, turno_id, dni, titulo, descripcion, ubicacion,
                                     inicio, fin, todo_el_dia, estado, creador, actualizado_google)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON DUPLICATE KEY UPDATE agenda_id = VALUES(agenda_id), origen = VALUES(origen), turno_id = VALUES(turno_id),
             dni = VALUES(dni), titulo = COALESCE(VALUES(titulo), titulo), descripcion = COALESCE(VALUES(descripcion), descripcion),
             ubicacion = COALESCE(VALUES(ubicacion), ubicacion), inicio = COALESCE(VALUES(inicio), inicio),
             fin = COALESCE(VALUES(fin), fin), todo_el_dia = VALUES(todo_el_dia), estado = VALUES(estado),
             creador = COALESCE(VALUES(creador), creador), actualizado_google = VALUES(actualizado_google)""",
        (cal_id, ev["id"], agenda_id, origen, turno_id, dni, (titulo or None) and titulo[:500], desc, (ev.get("location") or None),
         ini, fin, todo_el_dia, estado, (ev.get("creator") or {}).get("email"), upd))
    if turno_id:
        # evento del sistema que alguien borró o movió en Google: el sistema manda, se vuelve a subir
        cur.execute("SELECT estado, gcal_event_id, CONCAT(DATE_FORMAT(fecha, '%%Y-%%m-%%d'), ' ', TIME_FORMAT(hora, '%%H:%%i')) AS cuando "
                    "FROM agenda_turnos WHERE id = %s", (turno_id,))
        t = cur.fetchone()
        if t and t["estado"] != "CANCELADO" and t["gcal_event_id"] == ev["id"]:
            movido = ini is not None and ini.strftime("%Y-%m-%d %H:%M") != t["cuando"]
            if estado == "cancelled" or movido:
                a_resubir.add(turno_id)


def bajar(svc, cur, dry):
    cur.execute("SELECT id, gcal_calendar_id AS cal FROM agendas WHERE gcal_calendar_id IS NOT NULL")
    total = manuales = 0
    cache, a_resubir = {}, set()
    for a in cur.fetchall():
        cal = a["cal"]
        cur.execute("SELECT sync_token FROM gcal_sync WHERE calendar_id = %s", (cal,))
        r = cur.fetchone()
        token = r["sync_token"] if r else None
        page, nuevo_token = None, None
        try:
            while True:
                kw = {"calendarId": cal, "showDeleted": True, "singleEvents": True, "maxResults": 250}
                if page:
                    kw["pageToken"] = page
                if token:
                    kw["syncToken"] = token
                try:
                    res = svc.events().list(**kw).execute()
                except HttpError as e:
                    if e.resp.status == 410 and token:       # token vencido: sincronización completa
                        print(f"  syncToken vencido en agenda {a['id']}: bajo todo de nuevo")
                        token, page = None, None
                        if not dry:
                            cur.execute("DELETE FROM gcal_eventos WHERE calendar_id = %s", (cal,))
                        continue
                    raise
                for ev in res.get("items", []):
                    total += 1
                    priv = (ev.get("extendedProperties") or {}).get("private") or {}
                    if PROP not in priv and ev.get("status") != "cancelled":
                        manuales += 1
                        print(f"  Evento a mano: {ev.get('summary')} ({(ev.get('start') or {}).get('dateTime') or (ev.get('start') or {}).get('date')})")
                    if not dry:
                        guardar_evento(cur, cal, a["id"], ev, cache, a_resubir)
                page = res.get("nextPageToken")
                if not page:
                    nuevo_token = res.get("nextSyncToken")
                    break
        except HttpError as e:
            if e.resp.status == 404:
                if not dry:
                    calendario_perdido(cur, a["id"], cal)
                continue
            if not dry:
                cur.execute("INSERT INTO gcal_sync (calendar_id, ultimo_error) VALUES (%s, %s) "
                            "ON DUPLICATE KEY UPDATE ultimo_error = VALUES(ultimo_error)", (cal, str(e)[:500]))
            raise
        if not dry:
            cur.execute("INSERT INTO gcal_sync (calendar_id, sync_token, ultimo_ok, ultimo_error) VALUES (%s, %s, NOW(), NULL) "
                        "ON DUPLICATE KEY UPDATE sync_token = VALUES(sync_token), ultimo_ok = NOW(), ultimo_error = NULL",
                        (cal, nuevo_token))
    if a_resubir and not dry:
        print(f"  {len(a_resubir)} turno(s) borrados o movidos en Google: se vuelven a subir")
        cur.execute("UPDATE agenda_turnos SET gcal_pendiente = 1 WHERE id IN (" + ",".join(["%s"] * len(a_resubir)) + ")",
                    tuple(a_resubir))
    return total, manuales


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--autorizar", action="store_true", help="autoriza la cuenta (abre el navegador)")
    ap.add_argument("--dry-run", action="store_true", help="muestra lo que haría, no escribe nada")
    args = ap.parse_args()

    if args.autorizar:
        svc = servicio(interactivo=True)
        cal = svc.calendars().get(calendarId="primary").execute()
        print(f"OK: autorizado como {cal.get('id')}")
        return 0

    # El calendario de Google es UNO solo (el real): solo lo maneja prod. Desde la base de dev no toca nada
    # (si no, "Lanzar ahora" en dev crearía calendarios o subiría turnos de prueba). GCAL_PERMITIR_DEV=1 para probar.
    import os
    base = os.environ.get("DB_NAME", "")
    if base != "personalv5" and os.environ.get("GCAL_PERMITIR_DEV") != "1":
        print(f"Base {base}: Google Calendar solo se sincroniza desde prod (personalv5). No se hace nada.")
        print("[sin novedades]")
        return 0

    svc = servicio()
    with MN.conn() as cn, cn.cursor() as cur:
        creados = asegurar_calendarios(svc, cur, args.dry_run)
        cn.commit()
        hechos, errores = subir(svc, cur, args.dry_run)
        cn.commit()
        total, manuales = bajar(svc, cur, args.dry_run)
        cn.commit()
        # segunda pasada: lo que se marcó para resubir en la bajada
        h2, e2 = subir(svc, cur, args.dry_run) if not args.dry_run else (0, 0)
        cn.commit()
    hechos, errores = hechos + h2, errores + e2
    print(f"OK: {creados} calendario(s) nuevo(s), {hechos} turno(s) subido(s), {errores} error(es), "
          f"{total} evento(s) bajado(s) ({manuales} a mano){' (dry-run)' if args.dry_run else ''}")
    if errores:
        return 1
    if not (creados or hechos or total):
        print("[sin novedades]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
