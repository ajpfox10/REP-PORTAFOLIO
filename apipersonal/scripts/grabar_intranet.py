# Grabadora de pasos para entrenar robots de la Intranet del Ministerio.
# Abre Chrome (perfil propio, no el de los robots) y registra en un .jsonl cada
# navegación, click, cambio de campo, Enter, submit y diálogo, con varios selectores
# candidatos. Los campos de contraseña se registran SIN su valor.
# Además guarda el HTML de cada página/frame cargado, para armar los selectores después.
# Se termina cerrando el navegador.
#
# Uso: python grabar_intranet.py [--nombre reset_claves] [--url https://...]
import os, sys, json, argparse, time, re
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--nombre", default="reset_claves")
ap.add_argument("--url", default="https://sistemas.ms.gba.gov.ar/intranet/login.php")
ap.add_argument("--perfil", default=r"D:\G\comparacion\grabacion_chrome_profile")
args = ap.parse_args()

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
OUT = Path(__file__).resolve().parent.parent / "logs" / "grabaciones" / f"{args.nombre}_{stamp}"
(OUT / "html").mkdir(parents=True, exist_ok=True)
LOG = OUT / "pasos.jsonl"
n_html = 0

def log(ev):
    ev["t"] = datetime.now().strftime("%H:%M:%S")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(json.dumps(ev, ensure_ascii=False)[:300], flush=True)

INIT_JS = r"""
(() => {
  if (window.__grab) return; window.__grab = true;
  const css = (el) => {
    if (!(el instanceof Element)) return '';
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 6) {
      let p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + '#' + CSS.escape(el.id)); break; }
      const sib = el.parentNode ? [...el.parentNode.children].filter(c => c.tagName === el.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      parts.unshift(p); el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const info = (el) => {
    const t = el.closest('a,button,input,select,textarea,label,[onclick],[role=button],td,li') || el;
    const isPwd = t.type === 'password';
    let label = '';
    if (t.id) { const l = document.querySelector('label[for="' + CSS.escape(t.id) + '"]'); if (l) label = l.innerText.trim(); }
    return {
      tag: t.tagName.toLowerCase(), id: t.id || null, name: t.getAttribute('name'),
      type: t.getAttribute('type'), cls: t.className && typeof t.className === 'string' ? t.className : null,
      text: isPwd ? '***' : ((t.innerText || t.value || '').trim().slice(0, 80) || null),
      href: t.getAttribute('href'), onclick: (t.getAttribute('onclick') || '').slice(0, 150) || null,
      placeholder: t.getAttribute('placeholder'), label: label || null, title: t.getAttribute('title'),
      css: css(t), password: isPwd,
      value: isPwd ? '***' : (t.tagName === 'SELECT'
        ? (t.options[t.selectedIndex] ? t.options[t.selectedIndex].text + ' [' + t.value + ']' : t.value)
        : (('value' in t) ? String(t.value).slice(0, 120) : null)),
    };
  };
  const send = (kind, el, extra) => { try { window.__grabar({ kind, url: location.href, el: el ? info(el) : null, ...(extra||{}) }); } catch (e) {} };
  document.addEventListener('click', e => send('click', e.target), true);
  document.addEventListener('change', e => send('change', e.target), true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Tab') send('key', e.target, { key: e.key }); }, true);
  document.addEventListener('submit', e => send('submit', e.target, { action: e.target.action }), true);
})();
"""

def snapshot(frame, motivo):
    global n_html
    try:
        n_html += 1
        name = f"{n_html:03d}_{re.sub(r'[^a-zA-Z0-9]+', '_', frame.url)[-80:]}.html"
        (OUT / "html" / name).write_text(frame.content(), encoding="utf-8")
        log({"kind": "html", "motivo": motivo, "url": frame.url, "archivo": name})
    except Exception as e:
        log({"kind": "html_error", "url": frame.url, "error": str(e)[:200]})

def wire(page):
    page.on("framenavigated", lambda fr: log({"kind": "nav", "url": fr.url, "main": fr == page.main_frame}))
    page.on("load", lambda: [snapshot(fr, "load") for fr in page.frames if fr.url not in ("about:blank", "")])
    def on_dialog(d):
        log({"kind": "dialog", "type": d.type, "message": d.message})
        # no lo aceptamos solos: lo deja para que el usuario responda
    page.on("dialog", on_dialog)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        args.perfil, channel="chrome", headless=False, no_viewport=True,
        args=["--start-maximized"])
    ctx.expose_binding("__grabar", lambda src, ev: log(ev))
    ctx.add_init_script(INIT_JS)
    ctx.on("page", lambda pg: (log({"kind": "popup", "url": pg.url}), wire(pg)))
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    wire(page)
    log({"kind": "inicio", "carpeta": str(OUT)})
    page.goto(args.url)
    try:
        while ctx.pages:
            ctx.pages[0].wait_for_timeout(1000)
    except Exception:
        pass
    log({"kind": "fin"})
    try: ctx.close()
    except Exception: pass
