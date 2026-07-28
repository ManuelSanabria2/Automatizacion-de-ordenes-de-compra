"""Alias de nomenclatura por proveedor (aprendizaje incremental, INSTRUCCIONS.MD §6.3).

Cuando el usuario confirma en la pantalla de revisión un ítem cuyo nombre no
venía de un alias exacto, se guarda (upsert) el alias para que la próxima
cotización de ese proveedor se resuelva de inmediato.

Convenciones:
- `nombre_proveedor_texto` se almacena recortado (strip) y literal — es lo que
  se le muestra al usuario. La comparación normalizada la hace quien lee.
- `proveedor_nit` se almacena en forma canónica (`normalizar_nit`): los PDF
  traen el mismo NIT de mil formas y sin esto el aprendizaje se fragmenta.
- La identidad del alias sigue siendo (proveedor_nit, nombre_proveedor_texto).
  `referencia_proveedor` es una vía de búsqueda adicional, no una segunda clave.
"""

from pydantic import BaseModel, field_validator

from app.core.supabase import obtener_cliente
from app.core.texto import normalizar, normalizar_nit

TABLA = "alias_productos"

# Los filtros .in_() viajan en la URL de PostgREST; se trocean para no exceder
# su longitud máxima (mismo criterio que en importacion_proveedores).
TAMANO_LOTE_SELECT = 200

# Tope de filas por página al recorrer tablas completas (límite de PostgREST).
TAMANO_PAGINA = 1000


class AliasGuardar(BaseModel):
    proveedor_nit: str
    nombre_proveedor_texto: str
    producto_empresa_id: str
    referencia_proveedor: str = ""

    @field_validator("proveedor_nit", "nombre_proveedor_texto", "producto_empresa_id")
    @classmethod
    def no_vacio(cls, valor: str) -> str:
        limpio = valor.strip()
        if not limpio:
            raise ValueError("El campo no puede estar vacío")
        return limpio


class Alias(BaseModel):
    id: str
    proveedor_nit: str
    nombre_proveedor_texto: str
    producto_empresa_id: str
    referencia_proveedor: str | None = None


def guardar_alias(datos: AliasGuardar) -> Alias:
    """Crea o actualiza el alias del proveedor para ese texto exacto."""
    fila = {
        "proveedor_nit": normalizar_nit(datos.proveedor_nit) or datos.proveedor_nit,
        "nombre_proveedor_texto": datos.nombre_proveedor_texto,
        "producto_empresa_id": datos.producto_empresa_id,
        "referencia_proveedor": datos.referencia_proveedor.strip() or None,
    }
    respuesta = (
        obtener_cliente()
        .table(TABLA)
        .upsert(fila, on_conflict="proveedor_nit,nombre_proveedor_texto")
        .execute()
    )
    return Alias(**respuesta.data[0])


# --- Lecturas para la cascada de resolución -----------------------------------


def alias_exactos(nit: str, textos: list[str]) -> dict[str, str]:
    """texto literal → producto_empresa_id, para un proveedor."""
    if not nit or not textos:
        return {}
    cliente = obtener_cliente()
    unicos = list(dict.fromkeys(textos))
    encontrados: dict[str, str] = {}
    for i in range(0, len(unicos), TAMANO_LOTE_SELECT):
        respuesta = (
            cliente.table(TABLA)
            .select("nombre_proveedor_texto, producto_empresa_id")
            .eq("proveedor_nit", nit)
            .in_("nombre_proveedor_texto", unicos[i : i + TAMANO_LOTE_SELECT])
            .execute()
        )
        for fila in respuesta.data:
            if fila["producto_empresa_id"]:
                encontrados[fila["nombre_proveedor_texto"]] = fila["producto_empresa_id"]
    return encontrados


def alias_del_proveedor(nit: str) -> tuple[dict[str, str], dict[str, str]]:
    """Todos los alias de un proveedor, indexados de dos formas.

    Devuelve (por texto normalizado, por referencia). Se traen todos los del NIT
    porque la comparación normalizada no se puede expresar como filtro de
    PostgREST, y por proveedor son pocos.
    """
    if not nit:
        return {}, {}
    respuesta = (
        obtener_cliente()
        .table(TABLA)
        .select("nombre_proveedor_texto, producto_empresa_id, referencia_proveedor")
        .eq("proveedor_nit", nit)
        .execute()
    )
    por_texto: dict[str, str] = {}
    por_referencia: dict[str, str] = {}
    for fila in respuesta.data:
        producto_id = fila["producto_empresa_id"]
        if not producto_id:
            continue
        por_texto[normalizar(fila["nombre_proveedor_texto"])] = producto_id
        referencia = (fila.get("referencia_proveedor") or "").strip().lower()
        if referencia:
            por_referencia[referencia] = producto_id
    return por_texto, por_referencia


def alias_globales(excluir_nit: str = "") -> dict[str, str]:
    """texto normalizado → producto_empresa_id, mirando a TODOS los proveedores.

    Dos proveedores distintos suelen escribir el mismo producto casi igual. Si
    alguien ya confirmó "CODO 90 GALV 1/2" para otro NIT, esa decisión sirve de
    pista aquí — con menos confianza que el alias propio, porque el mismo texto
    puede significar cosas distintas según el proveedor.
    """
    cliente = obtener_cliente()
    encontrados: dict[str, str] = {}
    desplazamiento = 0
    while True:
        consulta = cliente.table(TABLA).select(
            "proveedor_nit, nombre_proveedor_texto, producto_empresa_id"
        )
        if excluir_nit:
            consulta = consulta.neq("proveedor_nit", excluir_nit)
        respuesta = consulta.range(
            desplazamiento, desplazamiento + TAMANO_PAGINA - 1
        ).execute()
        for fila in respuesta.data:
            if fila["producto_empresa_id"]:
                encontrados.setdefault(
                    normalizar(fila["nombre_proveedor_texto"]), fila["producto_empresa_id"]
                )
        if len(respuesta.data) < TAMANO_PAGINA:
            return encontrados
        desplazamiento += TAMANO_PAGINA


def pares_historicos() -> dict[str, str]:
    """texto normalizado → producto_empresa_id, según las órdenes ya emitidas.

    `ordenes_compra_items` guarda el texto original del proveedor junto al
    producto que finalmente se le asignó: es una decisión humana ya confirmada y
    congelada en un documento oficial. Las órdenes anteriores a la migración
    `20260714120000` no tienen `descripcion_proveedor` y simplemente no aportan.
    """
    cliente = obtener_cliente()
    encontrados: dict[str, str] = {}
    desplazamiento = 0
    while True:
        respuesta = (
            cliente.table("ordenes_compra_items")
            .select("descripcion_proveedor, producto_empresa_id")
            .not_.is_("descripcion_proveedor", "null")
            .range(desplazamiento, desplazamiento + TAMANO_PAGINA - 1)
            .execute()
        )
        for fila in respuesta.data:
            texto = (fila.get("descripcion_proveedor") or "").strip()
            if texto and fila["producto_empresa_id"]:
                encontrados.setdefault(normalizar(texto), fila["producto_empresa_id"])
        if len(respuesta.data) < TAMANO_PAGINA:
            return encontrados
        desplazamiento += TAMANO_PAGINA
