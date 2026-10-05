"""Probe READ-ONLY: entra a la Intranet (Parte de Novedades -> Listados -> plantel/report) y
vuelca los formularios de la pagina de Reportes (ids, selects, botones) para armar el robot."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import cargar_ausentes_intranet as I

URL_REPORT = "https://sistemas.ms.gba.gov.ar/partenovedades/web/app.php/plantel/report"
OUT = r"C:\apps\personaldev\apipersonal\logs\intranet_probe_reportes.html"

with sync_playwright() as p:
    browser, page = I.nueva_pagina(p)
    try:
        I.login(page, os.environ.get("INTRANET_PASS"), "HOSPITAL")
        page.goto(URL_REPORT, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(1500)
        open(OUT, "w", encoding="utf-8").write(page.content())
        info = page.evaluate("""() => Array.from(document.querySelectorAll('form')).map(f => ({
            action: f.getAttribute('action'), method: f.method, id: f.id, name: f.name,
            titulo: (f.closest('.panel, .card, div')?.querySelector('.panel-heading, .card-header, h3, h4')?.innerText || '').trim().slice(0, 60),
            campos: Array.from(f.querySelectorAll('input, select, button, textarea')).map(e => ({
                tag: e.tagName, type: e.type, id: e.id, name: e.name, value: (e.value || '').slice(0, 30),
                texto: (e.innerText || '').trim().slice(0, 40),
                opciones: e.tagName === 'SELECT' ? Array.from(e.options).map(o => o.value + '=' + o.text.trim()).slice(0, 12) : undefined,
            })),
        }))""")
        print(json.dumps(info, ensure_ascii=False, indent=1))
    finally:
        browser.close()
