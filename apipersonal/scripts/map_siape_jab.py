"""
Mapea controles visibles y accesibles de SiAPe usando Java Access Bridge.

No ejecuta acciones sobre SiAPe: solo lee el arbol de accesibilidad y guarda:
  - siape_jab_map.json
  - siape_jab_map.txt
"""

import argparse
import json
import time
from collections import deque
from pathlib import Path

from pyjab.jabdriver import JABDriver
from pyjab.jabelement import JABElement


TITLE = "Sistema Unico Provincial de Administracion de Personal"
BRIDGE_DLL = r"C:\Program Files\Java\jre1.8.0_333\bin\WindowsAccessBridge-64.dll"


def context_id(el):
    ctx = el.accessible_context
    return int(getattr(ctx, "value", ctx))


def info_for(el, depth, parent_id=None):
    data = el.get_element_information()
    bounds = data.get("bounds") or {}
    return {
        "id": context_id(el),
        "parent_id": parent_id,
        "depth": depth,
        "role": data.get("role") or "",
        "role_en_us": data.get("role_en_us") or "",
        "name": data.get("name") or "",
        "description": data.get("description") or "",
        "states": data.get("states") or [],
        "states_en_us": data.get("states_en_us") or [],
        "bounds": bounds,
        "children_count": data.get("children_count") or 0,
        "index_in_parent": data.get("index_in_parent"),
        "object_depth": data.get("object_depth"),
        "accessible_action": bool(data.get("accessible_action")),
        "accessible_text": bool(data.get("accessible_text")),
        "accessible_selection": bool(data.get("accessible_selection")),
        "accessible_component": bool(data.get("accessible_component")),
        "text": data.get("text") if "text" in data else None,
    }


def iter_children(el):
    for index in range(el.children_count):
        try:
            child_acc = el.bridge.getAccessibleChildFromContext(
                el.vmid, el.accessible_context, index
            )
            yield JABElement(el.bridge, el.hwnd, el.vmid, child_acc)
        except Exception:
            continue


def useful(row):
    states = set(row["states"])
    showing = "mostrando" in states or "visible" in states or "showing" in states
    named = bool(row["name"].strip() or row["description"].strip())
    actionable = row["accessible_action"] or row["accessible_text"] or row["role"] in {
        "menu",
        "menu item",
        "push button",
        "combo box",
        "text",
        "password text",
        "check box",
        "table",
        "list",
        "tree",
        "page tab",
    }
    bounds = row["bounds"] or {}
    has_size = (bounds.get("width") or 0) > 0 and (bounds.get("height") or 0) > 0
    return showing and (named or actionable or has_size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(Path(__file__).resolve().parent))
    ap.add_argument("--max-depth", type=int, default=14)
    ap.add_argument("--max-nodes", type=int, default=25000)
    ap.add_argument("--all", action="store_true", help="guardar tambien nodos poco utiles")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    driver = JABDriver(title=TITLE, bridge_dll=BRIDGE_DLL, timeout=12)
    root = driver.root_element

    rows = []
    seen_contexts = set()
    seen_useful = set()
    queue = deque([(root, 0, None)])

    while queue and len(seen_contexts) < args.max_nodes:
        el, depth, parent_id = queue.popleft()
        try:
            cid = context_id(el)
            if cid in seen_contexts:
                continue
            seen_contexts.add(cid)
            row = info_for(el, depth, parent_id)
        except Exception:
            continue

        key = (
            row["role"],
            row["name"],
            row["description"],
            tuple(sorted((row["bounds"] or {}).items())),
        )
        if args.all or useful(row):
            if key not in seen_useful:
                rows.append(row)
                seen_useful.add(key)

        if depth < args.max_depth:
            for child in iter_children(el):
                queue.append((child, depth + 1, row["id"]))

    payload = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "title": TITLE,
        "nodes_seen": len(seen_contexts),
        "nodes_saved": len(rows),
        "controls": rows,
    }

    json_path = out_dir / "siape_jab_map.json"
    txt_path = out_dir / "siape_jab_map.txt"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        f"SiAPe JAB map - {payload['generated_at']}",
        f"nodes_seen={payload['nodes_seen']} nodes_saved={payload['nodes_saved']}",
        "",
    ]
    for row in rows:
        b = row["bounds"] or {}
        lines.append(
            f"{'  ' * row['depth']}[{row['role']}] name={row['name']!r} "
            f"desc={row['description']!r} states={','.join(row['states'])!r} "
            f"bounds=({b.get('x')},{b.get('y')},{b.get('width')},{b.get('height')}) "
            f"action={row['accessible_action']} text={row['accessible_text']}"
        )
    txt_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"JSON: {json_path}")
    print(f"TXT:  {txt_path}")
    print(f"nodes_seen={payload['nodes_seen']} nodes_saved={payload['nodes_saved']}")


if __name__ == "__main__":
    main()
