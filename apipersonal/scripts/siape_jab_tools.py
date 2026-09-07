"""
Herramientas chicas para operar SiAPe por Java Access Bridge durante el mapeo.

Uso seguro:
  python siape_jab_tools.py list --contains Ausencias
  python siape_jab_tools.py click --name "Ausencias Eventuales nemotécnico A"
"""

import argparse
import sys
import time
from collections import deque

from pyjab.jabdriver import JABDriver
from pyjab.jabelement import JABElement


TITLE = "Sistema Unico Provincial de Administracion de Personal"
BRIDGE_DLL = r"C:\Program Files\Java\jre1.8.0_333\bin\WindowsAccessBridge-64.dll"


def context_id(el):
    ctx = el.accessible_context
    return int(getattr(ctx, "value", ctx))


def iter_children(el):
    for index in range(el.children_count):
        try:
            child_acc = el.bridge.getAccessibleChildFromContext(
                el.vmid, el.accessible_context, index
            )
            yield JABElement(el.bridge, el.hwnd, el.vmid, child_acc)
        except Exception:
            continue


def driver():
    return JABDriver(title=TITLE, bridge_dll=BRIDGE_DLL, timeout=12)


def walk(max_depth=30, max_nodes=30000):
    root = driver().root_element
    seen = set()
    queue = deque([(root, 0)])
    while queue and len(seen) < max_nodes:
        el, depth = queue.popleft()
        try:
            cid = context_id(el)
            if cid in seen:
                continue
            seen.add(cid)
            info = el.get_element_information()
        except Exception:
            continue
        yield el, depth, info
        if depth < max_depth:
            for child in iter_children(el):
                queue.append((child, depth + 1))


def find_by_name(name, max_depth=30):
    for el, depth, info in walk(max_depth=max_depth):
        if (info.get("name") or "") == name:
            return el, depth, info
    return None, None, None


def cmd_list(args):
    needle = (args.contains or "").lower()
    for _el, depth, info in walk(max_depth=args.max_depth):
        name = info.get("name") or ""
        desc = info.get("description") or ""
        role = info.get("role") or ""
        if needle and needle not in name.lower() and needle not in desc.lower():
            continue
        bounds = info.get("bounds") or {}
        print(
            f"{depth:02d} | {role:<16} | {name} | {desc} | "
            f"{bounds.get('x')},{bounds.get('y')},{bounds.get('width')},{bounds.get('height')} | "
            f"action={bool(info.get('accessible_action'))}"
        )


def cmd_click(args):
    el, _depth, info = find_by_name(args.name, max_depth=args.max_depth)
    if not el:
        print(f"No encontre nombre exacto: {args.name}", file=sys.stderr)
        return 2
    try:
        el.click(simulate=args.simulate)
    except Exception as e:
        print(f"Fallo click JAB directo: {e}", file=sys.stderr)
        if not args.fallback_simulate:
            return 3
        el.click(simulate=True)
    time.sleep(args.wait)
    bounds = info.get("bounds") or {}
    print(
        f"click OK: {info.get('role')} {info.get('name')} "
        f"bounds={bounds.get('x')},{bounds.get('y')},{bounds.get('width')},{bounds.get('height')}"
    )
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-depth", type=int, default=30)
    sub = ap.add_subparsers(dest="cmd", required=True)

    list_ap = sub.add_parser("list")
    list_ap.add_argument("--contains", default="")
    list_ap.set_defaults(func=cmd_list)

    click_ap = sub.add_parser("click")
    click_ap.add_argument("--name", required=True)
    click_ap.add_argument("--simulate", action="store_true")
    click_ap.add_argument("--fallback-simulate", action="store_true")
    click_ap.add_argument("--wait", type=float, default=1.0)
    click_ap.set_defaults(func=cmd_click)

    args = ap.parse_args()
    raise SystemExit(args.func(args) or 0)


if __name__ == "__main__":
    main()
