"""Importación masiva de proveedores desde Excel (INSTRUCCIONS.MD §6.6).

Reglas:
- Columnas requeridas: NIT y Nombre (su ausencia en el archivo es error fatal;
  su vacío en una fila es error de esa fila). Las demás son opcionales.
- Upsert por NIT: actualiza si existe, crea si no. Nunca borra proveedores
  ausentes del archivo (carga incremental).
- NIT duplicado dentro del archivo: advertencia, no error — gana la última
  ocurrencia.
"""

import unicodedata
from datetime import datetime, timezone
from io import BytesIO
from zipfile import BadZipFile

import pandas as pd
from pydantic import BaseModel

from app.core.supabase import obtener_cliente

COLUMNAS_REQUERIDAS = ("nit", "nombre")
COLUMNAS_OPCIONALES = ("direccion", "ciudad", "contacto", "telefono", "email")

# Los filtros .in_() viajan en la URL de PostgREST; se trocean para no exceder
# su longitud máxima. El upsert va en el cuerpo, pero se acota igualmente.
TAMANO_LOTE_SELECT = 200
TAMANO_LOTE_UPSERT = 500


class ErrorColumnasFaltantes(ValueError):
    """Faltan columnas requeridas en el Excel (el router responde 400)."""


class ErrorArchivoInvalido(ValueError):
    """El archivo no es un .xlsx legible o no tiene filas (el router responde 400)."""


class ErrorFila(BaseModel):
    fila: int  # número de fila en Excel (encabezado = 1, datos desde 2)
    motivo: str


class ResumenImportacion(BaseModel):
    total_filas: int
    nuevos: int
    actualizados: int
    errores: list[ErrorFila]
    advertencias: list[str]


def normalizar_encabezado(texto: str) -> str:
    """"Dirección", "DIRECCION" y " direccion " se vuelven "direccion"."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFD", str(texto)) if not unicodedata.combining(c)
    )
    return sin_acentos.strip().lower()


def normalizar_celda(valor) -> str | None:
    """Celda de pandas → texto limpio o None si está vacía.

    Aun con dtype=str, las celdas vacías llegan como NaN y los números pueden
    llegar como "900123456.0"; aquí se corrigen ambos casos.
    """
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return None
    texto = str(valor).strip()
    if not texto:
        return None
    entero, punto, decimal = texto.partition(".")
    if punto and entero.isdigit() and decimal == "0":
        return entero
    return texto


def parsear_excel(
    contenido: bytes,
) -> tuple[dict[str, dict], list[ErrorFila], list[str], int]:
    """Lee y valida el Excel.

    Devuelve (proveedores válidos por NIT, errores por fila, advertencias,
    total de filas de datos). En duplicados gana la última ocurrencia.
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

    validos: dict[str, dict] = {}
    fila_por_nit: dict[str, int] = {}
    errores: list[ErrorFila] = []
    advertencias: list[str] = []

    for indice, fila in df.iterrows():
        numero_fila = int(indice) + 2  # +1 por el encabezado, +1 porque Excel arranca en 1
        nit = normalizar_celda(fila.get("nit"))
        nombre = normalizar_celda(fila.get("nombre"))

        if not nit:
            errores.append(ErrorFila(fila=numero_fila, motivo="NIT vacío"))
            continue
        if not nombre:
            errores.append(ErrorFila(fila=numero_fila, motivo="Nombre vacío"))
            continue

        if nit in fila_por_nit:
            advertencias.append(
                f"NIT {nit} duplicado en filas {fila_por_nit[nit]} y {numero_fila}; "
                f"se conservó la fila {numero_fila}"
            )

        proveedor = {"nit": nit, "nombre": nombre}
        for col in COLUMNAS_OPCIONALES:
            proveedor[col] = normalizar_celda(fila.get(col)) if col in df.columns else None

        validos[nit] = proveedor
        fila_por_nit[nit] = numero_fila

    return validos, errores, advertencias, len(df)


def _nits_existentes(nits: list[str]) -> set[str]:
    cliente = obtener_cliente()
    existentes: set[str] = set()
    for i in range(0, len(nits), TAMANO_LOTE_SELECT):
        lote = nits[i : i + TAMANO_LOTE_SELECT]
        respuesta = cliente.table("proveedores").select("nit").in_("nit", lote).execute()
        existentes.update(fila["nit"] for fila in respuesta.data)
    return existentes


def importar_proveedores(contenido: bytes) -> ResumenImportacion:
    """Valida el Excel y hace upsert por NIT. Nunca borra proveedores."""
    validos, errores, advertencias, total_filas = parsear_excel(contenido)

    if not validos:
        return ResumenImportacion(
            total_filas=total_filas,
            nuevos=0,
            actualizados=0,
            errores=errores,
            advertencias=advertencias,
        )

    existentes = _nits_existentes(list(validos))

    # El default de actualizado_en solo aplica en insert; en updates se fija aquí.
    ahora = datetime.now(timezone.utc).isoformat()
    filas = [{**proveedor, "actualizado_en": ahora} for proveedor in validos.values()]

    cliente = obtener_cliente()
    for i in range(0, len(filas), TAMANO_LOTE_UPSERT):
        lote = filas[i : i + TAMANO_LOTE_UPSERT]
        cliente.table("proveedores").upsert(lote, on_conflict="nit").execute()

    return ResumenImportacion(
        total_filas=total_filas,
        nuevos=len(set(validos) - existentes),
        actualizados=len(existentes),
        errores=errores,
        advertencias=advertencias,
    )
