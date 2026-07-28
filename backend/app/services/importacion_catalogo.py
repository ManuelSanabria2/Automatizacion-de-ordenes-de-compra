"""Importación masiva del catálogo oficial desde Excel.

Fuente: el Excel "Requisición Abastecimientos" (hoja Catalogo, columnas
Grupo | Codigo | Item | Unidad). El catálogo del sistema es espejo de ese
archivo: mismo nombre (Item), código y grupo.

Reglas:
- Columnas requeridas: Item y Codigo (su ausencia en el archivo es error
  fatal). Grupo y Unidad son opcionales.
- La clave de identidad es la combinación nombre + código (insensible a
  mayúsculas): si ya existe, se actualizan grupo y unidad; si no, se crea.
  No hay restricción de unicidad en la base para esa pareja, así que el
  emparejamiento se hace aquí y las actualizaciones van por id.
- Carga incremental: nunca borra productos ausentes del archivo (pueden
  estar referenciados por alias y por órdenes ya emitidas).
- Pareja nombre+código duplicada dentro del archivo: advertencia, no error —
  gana la última ocurrencia.
- Las filas sin cambios no se reescriben (el archivo completo se reimporta
  cada vez que la empresa lo actualiza).
"""

from io import BytesIO
from zipfile import BadZipFile

import pandas as pd
from pydantic import BaseModel

from app.core.supabase import obtener_cliente
from app.core.texto import normalizar_encabezado
from app.services import catalogo_cache
from app.services.importacion_proveedores import (
    ErrorArchivoInvalido,
    ErrorColumnasFaltantes,
    ErrorFila,
    normalizar_celda,
)

TABLA = "productos_empresa"
COLUMNAS_REQUERIDAS = ("item", "codigo")

# PostgREST limita cada select a 1000 filas; el catálogo se lee paginado.
TAMANO_PAGINA_SELECT = 1000
TAMANO_LOTE_ESCRITURA = 500


class ResumenImportacionCatalogo(BaseModel):
    total_filas: int
    nuevos: int
    actualizados: int
    sin_cambios: int
    errores: list[ErrorFila]
    advertencias: list[str]


def _clave(nombre: str, codigo: str | None) -> tuple[str, str]:
    """Identidad nombre + código, insensible a mayúsculas."""
    return (nombre.strip().lower(), (codigo or "").strip().lower())


def parsear_excel_catalogo(
    contenido: bytes,
) -> tuple[dict[tuple[str, str], dict], list[ErrorFila], list[str], int]:
    """Lee y valida el Excel del catálogo.

    Devuelve (productos válidos por clave nombre+código, errores por fila,
    advertencias, total de filas de datos). En duplicados gana la última
    ocurrencia.
    """
    try:
        df = pd.read_excel(BytesIO(contenido), dtype=str)
    except (BadZipFile, ValueError) as exc:
        raise ErrorArchivoInvalido(f"No se pudo leer el archivo Excel: {exc}") from exc

    df.columns = [normalizar_encabezado(col) for col in df.columns]

    faltantes = [col for col in COLUMNAS_REQUERIDAS if col not in df.columns]
    if faltantes:
        raise ErrorColumnasFaltantes(
            "Faltan columnas requeridas en el archivo: " + ", ".join(faltantes)
        )

    if df.empty:
        raise ErrorArchivoInvalido("El archivo no contiene filas de datos")

    validos: dict[tuple[str, str], dict] = {}
    fila_por_clave: dict[tuple[str, str], int] = {}
    errores: list[ErrorFila] = []
    advertencias: list[str] = []

    for indice, fila in df.iterrows():
        numero_fila = int(indice) + 2  # +1 por el encabezado, +1 porque Excel arranca en 1
        nombre = normalizar_celda(fila.get("item"))
        codigo = normalizar_celda(fila.get("codigo"))

        if not nombre:
            errores.append(ErrorFila(fila=numero_fila, motivo="Item vacío"))
            continue
        if not codigo:
            errores.append(ErrorFila(fila=numero_fila, motivo="Código vacío"))
            continue

        clave = _clave(nombre, codigo)
        if clave in fila_por_clave:
            advertencias.append(
                f"Item «{nombre}» con código {codigo} duplicado en filas "
                f"{fila_por_clave[clave]} y {numero_fila}; se conservó la fila {numero_fila}"
            )

        validos[clave] = {
            "nombre_oficial": nombre,
            "codigo": codigo,
            "grupo": normalizar_celda(fila.get("grupo")) if "grupo" in df.columns else None,
            "unidad_default": (
                normalizar_celda(fila.get("unidad")) if "unidad" in df.columns else None
            ),
        }
        fila_por_clave[clave] = numero_fila

    return validos, errores, advertencias, len(df)


def _catalogo_existente() -> list[dict]:
    """Catálogo completo (paginado: PostgREST corta cada select en 1000 filas)."""
    cliente = obtener_cliente()
    filas: list[dict] = []
    while True:
        respuesta = (
            cliente.table(TABLA)
            .select("id, nombre_oficial, codigo, grupo, unidad_default")
            .order("id")
            .range(len(filas), len(filas) + TAMANO_PAGINA_SELECT - 1)
            .execute()
        )
        filas.extend(respuesta.data)
        if len(respuesta.data) < TAMANO_PAGINA_SELECT:
            return filas


def importar_catalogo(contenido: bytes) -> ResumenImportacionCatalogo:
    """Valida el Excel y sincroniza el catálogo por nombre+código.

    Crea los productos nuevos, actualiza grupo/unidad de los existentes y no
    toca la tasa de IVA ni borra productos ausentes del archivo.
    """
    validos, errores, advertencias, total_filas = parsear_excel_catalogo(contenido)

    if not validos:
        return ResumenImportacionCatalogo(
            total_filas=total_filas,
            nuevos=0,
            actualizados=0,
            sin_cambios=0,
            errores=errores,
            advertencias=advertencias,
        )

    existentes = {
        _clave(fila["nombre_oficial"], fila["codigo"]): fila
        for fila in _catalogo_existente()
    }

    nuevos: list[dict] = []
    cambiados: list[dict] = []
    sin_cambios = 0
    for clave, producto in validos.items():
        actual = existentes.get(clave)
        if actual is None:
            nuevos.append(producto)
        elif (
            producto["grupo"] != actual["grupo"]
            or producto["unidad_default"] != actual["unidad_default"]
        ):
            cambiados.append({**producto, "id": actual["id"]})
        else:
            sin_cambios += 1

    cliente = obtener_cliente()
    for i in range(0, len(nuevos), TAMANO_LOTE_ESCRITURA):
        cliente.table(TABLA).insert(nuevos[i : i + TAMANO_LOTE_ESCRITURA]).execute()
    # Con el id conocido, el upsert por lotes actualiza solo las columnas
    # enviadas (la tasa de IVA existente no se toca).
    for i in range(0, len(cambiados), TAMANO_LOTE_ESCRITURA):
        cliente.table(TABLA).upsert(
            cambiados[i : i + TAMANO_LOTE_ESCRITURA], on_conflict="id"
        ).execute()

    if nuevos or cambiados:
        catalogo_cache.invalidar()

    return ResumenImportacionCatalogo(
        total_filas=total_filas,
        nuevos=len(nuevos),
        actualizados=len(cambiados),
        sin_cambios=sin_cambios,
        errores=errores,
        advertencias=advertencias,
    )
