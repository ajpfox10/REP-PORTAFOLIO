"""Segunda parte de corregir_puntual_20261104.py: verificar/cargar el FC 02/10 de ROMANO y hacer
HERRERA en una sesion nueva de UPA 4 (el cambio de dependencia en la misma sesion fallo)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import corregir_puntual_20261104 as P
from corregir_puntual_20261104 import C, V, L28, anotar, abrir, cargar, PW
from playwright.sync_api import sync_playwright

def main():
    with sync_playwright() as p:
        for dep in ("HOSPITAL", "UPA 4"):
            browser, page = C.nueva_pagina(p)
            try:
                C.login(page, PW, dep)
                if dep == "HOSPITAL":
                    abrir(page, 31905218, dep)
                    if V.novedad_fc_ya_cargada(page, "02/10/2026", "02/10/2026"):
                        print("ROMANO: el FC 02/10 SI quedo cargado")
                        anotar(4237, "OK", "34 - FRANCO COMPENSATORIO", "02/10/2026: verificado en el historial (la Intranet no habia confirmado)")
                    else:
                        print("ROMANO: el FC 02/10 NO esta -> lo cargo de nuevo")
                        ok = cargar(page, 31905218, dep, None, "02/10/2026", "02/10/2026", 4237)
                        abrir(page, 31905218, dep)
                        if not ok and V.novedad_fc_ya_cargada(page, "02/10/2026", "02/10/2026"):
                            anotar(4237, "OK", "34 - FRANCO COMPENSATORIO", "02/10/2026: verificado en el historial")
                else:
                    print("HERRERA 35633835: borrar 28 30-31/10, cargar FC 30/10 y 28 31/10")
                    abrir(page, 35633835, dep)
                    b, otros = L28.liberar_28(page, 35633835, "30/10/2026", "30/10/2026", "FC de SIAPE (corrección)")
                    print(f"  28 borrados: {b} {otros or ''}")
                    if b and not otros:
                        cargar(page, 35633835, dep, None, "30/10/2026", "30/10/2026", 11781)
                        cargar(page, 35633835, dep, "28 - INASISTENCIA", "31/10/2026", "31/10/2026", 11875)
                        abrir(page, 35633835, dep)
                        print("  FC 30/10 en historial:", V.novedad_fc_ya_cargada(page, "30/10/2026", "30/10/2026"),
                              "| 28 31/10 en historial:", C.ya_cargada_igual(page, "28 - INASISTENCIA", "31/10/2026", "31/10/2026"))
            finally:
                try: C.cerrar_sesion(page)
                except Exception: pass
                browser.close()

if __name__ == "__main__":
    main()
