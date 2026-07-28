"""Catálogo oficial normalizado y cacheado en memoria.

El matching compara el texto del proveedor contra los >2000 nombres del
catálogo. Normalizar cada nombre en cada comparación sería normalizar el
catálogo entero una vez por ítem (y una cotización trae 70 ítems), así que se
normaliza una sola vez al cargar y se guarda con un TTL.

Invalidación: cualquier escritura en `productos_empresa` debe llamar a
`invalidar()` — lo hacen `catalogo_productos` (alta/edición) e
`importacion_catalogo` (importación masiva).

Nota operativa: el caché es por proceso. Con una sola instancia (el plan actual
de Render) la invalidación explícita lo mantiene exacto; si algún día hay varias
instancias, una escritura puede tardar hasta `TTL_CACHE_CATALOGO` en verse en
las demás.
"""

import threading
import time
from dataclasses import dataclass

from app.core import config
from app.core.supabase import obtener_cliente
from app.core.texto import extraer_medidas, normalizar

# PostgREST limita cada select a 1000 filas; el catálogo se lee por páginas.
TAMANO_PAGINA_CATALOGO = 1000


@dataclass(frozen=True, slots=True)
class FilaCatalogo:
    """Producto del catálogo con sus formas normalizadas ya calculadas."""

    id: str
    nombre_oficial: str
    codigo: str | None
    grupo: str | None
    unidad_default: str | None
    nombre_normalizado: str
    unidad_normalizada: str
    medidas: frozenset[str]


_catalogo: list[FilaCatalogo] | None = None
_cargado_en: float = 0.0
_candado = threading.Lock()


def _leer_de_supabase() -> list[FilaCatalogo]:
    cliente = obtener_cliente()
    filas: list[FilaCatalogo] = []
    while True:
        respuesta = (
            cliente.table("productos_empresa")
            .select("id, nombre_oficial, codigo, grupo, unidad_default")
            .order("nombre_oficial")
            .range(len(filas), len(filas) + TAMANO_PAGINA_CATALOGO - 1)
            .execute()
        )
        for fila in respuesta.data:
            nombre_normalizado = normalizar(fila["nombre_oficial"])
            filas.append(
                FilaCatalogo(
                    id=fila["id"],
                    nombre_oficial=fila["nombre_oficial"],
                    codigo=fila.get("codigo"),
                    grupo=fila.get("grupo"),
                    unidad_default=fila.get("unidad_default"),
                    nombre_normalizado=nombre_normalizado,
                    unidad_normalizada=normalizar(fila.get("unidad_default") or ""),
                    medidas=extraer_medidas(nombre_normalizado),
                )
            )
        if len(respuesta.data) < TAMANO_PAGINA_CATALOGO:
            return filas


def obtener_catalogo() -> list[FilaCatalogo]:
    """Catálogo completo y normalizado, releído solo si venció el TTL."""
    global _catalogo, _cargado_en
    with _candado:
        vencido = time.monotonic() - _cargado_en >= config.TTL_CACHE_CATALOGO
        if _catalogo is None or vencido:
            _catalogo = _leer_de_supabase()
            _cargado_en = time.monotonic()
        return _catalogo


def invalidar() -> None:
    """Fuerza la relectura en la próxima consulta (tras escribir en el catálogo)."""
    global _catalogo, _cargado_en
    with _candado:
        _catalogo = None
        _cargado_en = 0.0
