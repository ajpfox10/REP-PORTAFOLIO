"""
ausente_peso.py  —  Cuántos días de 28-INASISTENCIA vale un AUSENTE SIN AVISO (05/11/2026, regla
del usuario). La misma regla está copiada en comparar_siape_ministerio_v2.mjs (pesoAusente): si se
cambia acá, cambiarla allá.

  domingo                                   -> 3
  sábado o feriado                          -> 2
  día con turno de MÁS de 6 horas ese día   -> 2
  resto (o sin horario cargado)             -> 1

Días seguidos se suman: el 28 va desde el primer día y dura la suma (mié 12 h + jue 12 h = 4 días).
Horario = foto de horarios_historial más reciente <= el día (si no hay, la primera).
"""
from collections import defaultdict
from datetime import timedelta

DIAS_HORARIO = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")   # date.weekday(): 0 = lunes


def _min(hhmm):
    try:
        h, m = str(hhmm).strip().split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def horas_turno(entrada, salida):
    """Horas del turno; cruza la medianoche si salida <= entrada (18-06 = 12 h, 07-07 = 24 h)."""
    e, s = _min(entrada), _min(salida)
    if e is None or s is None:
        return 0
    dur = (s - e) % (24 * 60)
    return (dur or 24 * 60) / 60


class Contexto:
    def __init__(self, cur, dnis):
        cur.execute("SELECT fecha FROM feriados")
        self.feriados = {r["fecha"] for r in cur.fetchall()}
        self.fotos = defaultdict(list)   # dni -> [(fecha, {weekday: horas})]
        dnis = sorted({int(d) for d in dnis if str(d).isdigit()})
        if dnis:
            cols = ", ".join(f"{d}_e, {d}_s" for d in DIAS_HORARIO)
            cur.execute(f"""SELECT dni, fecha, {cols} FROM horarios_historial
                             WHERE dni IN ({",".join(["%s"] * len(dnis))}) ORDER BY fecha""", dnis)
            for h in cur.fetchall():
                self.fotos[int(h["dni"])].append(
                    (h["fecha"], {i: horas_turno(h[f"{d}_e"], h[f"{d}_s"]) for i, d in enumerate(DIAS_HORARIO)}))

    def horas(self, dni, d):
        lista = self.fotos.get(int(dni)) if str(dni).isdigit() else None
        if not lista:
            return 0
        horas = lista[0][1]
        for f, hs in lista:
            if f <= d:
                horas = hs
        return horas.get(d.weekday(), 0)

    def peso(self, dni, d):
        if d.weekday() == 6:
            return 3
        if d.weekday() == 5 or d in self.feriados:
            return 2
        return 2 if self.horas(dni, d) > 6 else 1

    def hasta_ministerio(self, dni, desde, hasta):
        """Último día del 28 para los ausentes SIAPE desde..hasta (días seguidos, se suman)."""
        total, d = 0, desde
        while d <= hasta:
            total += self.peso(dni, d)
            d += timedelta(days=1)
        return desde + timedelta(days=max(total, 1) - 1)
