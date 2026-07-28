"""Evaluación de la precisión de `resolver_productos()`.

Mide la cascada de resolución de nombres contra un set de casos con la respuesta
correcta conocida (`tests/datos/golden_resolucion.json`) y reporta:

- **acierto top-1**: el candidato preseleccionado (el que la pantalla de revisión
  marca por defecto) es el producto correcto.
- **cobertura top-3 / top-N**: el correcto aparece en algún lugar de la lista de
  candidatos, aunque no sea el primero (el usuario lo tiene a un clic).
- reparto por `origen` (alias / fuzzy / gemini / sin_match / ...).
- llamadas a Gemini y tiempo total.

Requiere las mismas variables de entorno que el backend (`backend/.env`): usa el
cliente real de Supabase y, si la cascada llega hasta ahí, la API real de Gemini.

Ejecutar desde `backend/`:

    python tests/evaluar_resolucion.py                # cascada completa
    python tests/evaluar_resolucion.py --sin-alias    # ignora alias_productos
    python tests/evaluar_resolucion.py --json base.json

`--sin-alias` es el modo importante para comparar cambios: el set de casos se
construyó a partir de alias ya confirmados, así que con la cascada completa todos
resuelven por alias con confianza 100 y la medición no diría nada del matching.
Neutralizando el paso de alias se mide lo que de verdad se quiere mejorar: qué tan
bien encuentra el producto correcto cuando lo ve por primera vez.

Para comparar antes/después: guardar un `--json` en cada versión y contrastarlos.

El set (`tests/datos/golden_resolucion.json`) NO está en el repositorio: sale de
datos reales de la empresa (NIT del proveedor, nombres del catálogo, UUIDs) y el
repositorio es público. Para regenerarlo, tomar de `alias_productos` los pares
que se hayan **verificado a mano** como correctos y volcarlos con esta forma:

    {"descripcion": "...", "origen": "...", "casos": [
      {"proveedor_nit": "800081030-1",
       "texto": "CODO 90 GALV 1/2\\"",        # como lo escribe el proveedor
       "unidad": "", "referencia": "",         # señales opcionales del PDF
       "producto_esperado_id": "<uuid de productos_empresa>",
       "nombre_esperado": "CODO 90 HG DE 1/2\\"",
       "codigo_esperado": "1518090309", "grupo_esperado": "..."}
    ]}

Curar a mano no es opcional: un alias guardado no es garantía de acierto. En la
primera medición, 10 de los 21 alias de la base apuntaban al producto
equivocado (se confirmaron cuando el matching devolvía el mismo score para todo
el catálogo), y meterlos al set habría fijado esos errores como la respuesta
correcta.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Permite ejecutarlo como script suelto (`python tests/evaluar_resolucion.py`)
# sin instalar el paquete: añade `backend/` al path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import resolucion_productos  # noqa: E402

RUTA_GOLDEN = Path(__file__).parent / "datos" / "golden_resolucion.json"


def cargar_casos(ruta: Path) -> list[dict]:
    documento = json.loads(ruta.read_text(encoding="utf-8"))
    casos = documento["casos"]
    if not casos:
        raise SystemExit(f"El set de evaluación está vacío: {ruta}")
    return casos


def neutralizar_alias() -> None:
    """Hace que los pasos de "ya confirmado" no encuentren nada (--sin-alias)."""
    resolucion_productos._alias_exactos = lambda *_a, **_k: {}
    resolucion_productos._alias_del_proveedor = lambda *_a, **_k: ({}, {})
    resolucion_productos._alias_globales = lambda *_a, **_k: {}
    resolucion_productos._pares_historicos = lambda *_a, **_k: {}


def _resolver(casos: list[dict]):
    """Llama a la cascada agrupando por NIT, igual que lo hace la app.

    Tolera las dos formas del contrato de entrada: `list[str]` (versión actual)
    y `list[ItemResolver]` (a partir de la Fase 2), para que el mismo script sirva
    de línea base antes del cambio y de medición después.
    """
    acepta_objetos = "ItemResolver" in dir(resolucion_productos)
    resoluciones: dict[int, object] = {}

    por_nit: dict[str, list[int]] = {}
    for i, caso in enumerate(casos):
        por_nit.setdefault(caso["proveedor_nit"], []).append(i)

    for nit, indices in por_nit.items():
        if acepta_objetos:
            items = [
                resolucion_productos.ItemResolver(
                    texto=casos[i]["texto"],
                    unidad=casos[i].get("unidad", ""),
                    referencia=casos[i].get("referencia", ""),
                )
                for i in indices
            ]
        else:
            items = [casos[i]["texto"] for i in indices]

        respuesta = resolucion_productos.resolver_productos(nit, items)
        for posicion, i in enumerate(indices):
            resoluciones[i] = respuesta.resoluciones[posicion]
        for advertencia in respuesta.advertencias:
            print(f"  advertencia ({nit}): {advertencia}")

    return [resoluciones[i] for i in range(len(casos))]


def evaluar(casos: list[dict]) -> dict:
    inicio = time.monotonic()
    resoluciones = _resolver(casos)
    segundos = time.monotonic() - inicio

    aciertos_top1 = 0
    aciertos_top3 = 0
    aciertos_topn = 0
    por_origen: dict[str, int] = {}
    fallos: list[dict] = []

    for caso, resolucion in zip(casos, resoluciones):
        esperado = caso["producto_esperado_id"]
        ids = [c.producto_empresa_id for c in resolucion.candidatos]
        por_origen[resolucion.origen] = por_origen.get(resolucion.origen, 0) + 1

        if ids[:1] == [esperado]:
            aciertos_top1 += 1
        if esperado in ids[:3]:
            aciertos_top3 += 1
        if esperado in ids:
            aciertos_topn += 1
        else:
            fallos.append(
                {
                    "texto": caso["texto"],
                    "esperado": caso["nombre_esperado"],
                    "origen": resolucion.origen,
                    "confianza": round(resolucion.confianza, 1),
                    "obtenidos": [
                        f"{c.nombre_oficial} ({round(c.score, 1)})"
                        for c in resolucion.candidatos[:3]
                    ],
                }
            )

    total = len(casos)
    return {
        "total": total,
        "top1": aciertos_top1,
        "top3": aciertos_top3,
        "topn": aciertos_topn,
        "pct_top1": round(100 * aciertos_top1 / total, 1),
        "pct_top3": round(100 * aciertos_top3 / total, 1),
        "pct_topn": round(100 * aciertos_topn / total, 1),
        "por_origen": por_origen,
        "segundos": round(segundos, 2),
        "fallos": fallos,
    }


def imprimir(resultado: dict, modo: str) -> None:
    print(f"\n=== Resolución de productos — {modo} ===")
    print(f"casos: {resultado['total']}   tiempo: {resultado['segundos']}s")
    print(f"  acierto top-1:    {resultado['top1']}/{resultado['total']}  ({resultado['pct_top1']}%)")
    print(f"  cobertura top-3:  {resultado['top3']}/{resultado['total']}  ({resultado['pct_top3']}%)")
    print(f"  cobertura top-N:  {resultado['topn']}/{resultado['total']}  ({resultado['pct_topn']}%)")
    print("  origen: " + ", ".join(f"{k}={v}" for k, v in sorted(resultado["por_origen"].items())))

    if resultado["fallos"]:
        print(f"\n  no encontrados en ningún candidato ({len(resultado['fallos'])}):")
        for fallo in resultado["fallos"]:
            print(f"    «{fallo['texto']}»")
            print(f"       esperado: {fallo['esperado']}")
            print(f"       obtenido: {' | '.join(fallo['obtenidos']) or '(sin candidatos)'}"
                  f"   [{fallo['origen']} {fallo['confianza']}]")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sin-alias",
        action="store_true",
        help="ignora alias_productos para medir el matching y no el atajo",
    )
    parser.add_argument("--golden", type=Path, default=RUTA_GOLDEN, help="set de casos")
    parser.add_argument("--json", type=Path, help="guarda el resultado para comparar después")
    args = parser.parse_args()

    casos = cargar_casos(args.golden)
    modo = "sin alias" if args.sin_alias else "cascada completa"
    if args.sin_alias:
        neutralizar_alias()

    resultado = evaluar(casos)
    imprimir(resultado, modo)

    if args.json:
        args.json.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nResultado guardado en {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
