"""Resolución de nombres de producto del proveedor (INSTRUCCIONS.MD §6.3 y §7).

Cascada por ítem:
1. Match exacto en `alias_productos` por (proveedor_nit, nombre_proveedor_texto).
2. Fuzzy matching (rapidfuzz) contra `productos_empresa.nombre_oficial`:
   se devuelven los 3 mejores candidatos con su score (0-100).
3. Si el mejor score queda bajo el umbral (`UMBRAL_FUZZY`, default 70), se pide
   a Gemini una sugerencia razonada — UNA sola llamada por lote de pendientes,
   para mantener el consumo de tokens mínimo. Si Gemini falla, se degrada a
   "sin_match" con una advertencia en lugar de fallar la petición.
4. Sin candidato aceptable → origen "sin_match" (resolución manual).

No persiste nada: los alias se crean/actualizan desde la pantalla de revisión.
Convención: los textos del proveedor se comparan y almacenan recortados (strip).
"""

import json
from typing import Literal

from google.genai import errors as errores_gemini
from google.genai import types
from pydantic import BaseModel, Field, ValidationError
from rapidfuzz import fuzz, process, utils

from app.core import config
from app.core.gemini import obtener_cliente as obtener_cliente_gemini
from app.core.supabase import obtener_cliente as obtener_cliente_supabase

# Los filtros .in_() viajan en la URL de PostgREST; se trocean para no exceder
# su longitud máxima (mismo criterio que en importacion_proveedores).
TAMANO_LOTE_SELECT = 200


# --- Modelos de respuesta ----------------------------------------------------


class Candidato(BaseModel):
    producto_empresa_id: str
    nombre_oficial: str
    score: float  # 0-100
    justificacion: str | None = None  # solo en sugerencias de Gemini


class ResolucionItem(BaseModel):
    texto_proveedor: str
    origen: Literal["alias", "fuzzy", "gemini", "sin_match"]
    confianza: float  # 0-100 (alias=100, fuzzy=mejor score, gemini=su confianza)
    candidatos: list[Candidato]


class RespuestaResolucion(BaseModel):
    resoluciones: list[ResolucionItem]
    advertencias: list[str]


class SolicitudResolucion(BaseModel):
    proveedor_nit: str = ""  # vacío: proveedor nuevo, se omite el paso de alias
    items: list[str]


# --- Schema de la sugerencia de Gemini ---------------------------------------


class SugerenciaGemini(BaseModel):
    texto: str = ""
    nombre_oficial: str | None = None  # nombre EXACTO del catálogo, o null
    confianza: float = Field(default=0, ge=0, le=100)
    justificacion: str = ""


class RespuestaSugerencias(BaseModel):
    sugerencias: list[SugerenciaGemini] = []


# --- Pasos de la cascada ------------------------------------------------------


def _sin_match(texto: str) -> ResolucionItem:
    return ResolucionItem(texto_proveedor=texto, origen="sin_match", confianza=0, candidatos=[])


def _cargar_catalogo() -> list[dict]:
    respuesta = (
        obtener_cliente_supabase()
        .table("productos_empresa")
        .select("id, nombre_oficial")
        .order("nombre_oficial")
        .execute()
    )
    return respuesta.data


def _alias_del_proveedor(nit: str, textos: list[str]) -> dict[str, str]:
    """texto del proveedor → producto_empresa_id (solo alias con producto asignado)."""
    if not nit or not textos:
        return {}
    cliente = obtener_cliente_supabase()
    unicos = list(dict.fromkeys(textos))
    alias: dict[str, str] = {}
    for i in range(0, len(unicos), TAMANO_LOTE_SELECT):
        lote = unicos[i : i + TAMANO_LOTE_SELECT]
        respuesta = (
            cliente.table("alias_productos")
            .select("nombre_proveedor_texto, producto_empresa_id")
            .eq("proveedor_nit", nit)
            .in_("nombre_proveedor_texto", lote)
            .execute()
        )
        for fila in respuesta.data:
            if fila["producto_empresa_id"]:
                alias[fila["nombre_proveedor_texto"]] = fila["producto_empresa_id"]
    return alias


def _prompt_sugerencias(textos: list[str], nombres_catalogo: list[str]) -> str:
    return (
        "Eres un asistente que reconcilia nombres de productos escritos por un "
        "proveedor con el catálogo oficial interno de una empresa en Colombia.\n\n"
        "Catálogo oficial (nombres exactos):\n"
        + json.dumps(nombres_catalogo, ensure_ascii=False)
        + "\n\nTextos del proveedor a resolver:\n"
        + json.dumps(textos, ensure_ascii=False)
        + "\n\nDevuelve ÚNICAMENTE un JSON con la clave \"sugerencias\": una lista "
        "con UN objeto por cada texto del proveedor, en el mismo orden, con las "
        "claves:\n"
        '- "texto": el texto del proveedor tal cual.\n'
        '- "nombre_oficial": el nombre EXACTO del catálogo que corresponde al '
        "mismo producto (misma naturaleza y especificación), o null si ninguno "
        "corresponde o dudas entre varios.\n"
        '- "confianza": número de 0 a 100.\n'
        '- "justificacion": una frase breve explicando la elección.\n'
    )


def _sugerencias_gemini(textos: list[str], nombres_catalogo: list[str]) -> list[SugerenciaGemini]:
    respuesta = obtener_cliente_gemini().models.generate_content(
        model=config.GEMINI_MODEL,
        contents=_prompt_sugerencias(textos, nombres_catalogo),
        config=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=RespuestaSugerencias,
        ),
    )
    if not respuesta.text:
        raise RuntimeError("Gemini devolvió una respuesta vacía")
    return RespuestaSugerencias.model_validate(json.loads(respuesta.text)).sugerencias


# --- Cascada completa ---------------------------------------------------------


def resolver_productos(proveedor_nit: str, textos: list[str]) -> RespuestaResolucion:
    advertencias: list[str] = []
    limpios = [(t or "").strip() for t in textos]

    catalogo = _cargar_catalogo()
    nombres = [fila["nombre_oficial"] for fila in catalogo]
    por_id = {fila["id"]: fila["nombre_oficial"] for fila in catalogo}
    alias = _alias_del_proveedor(proveedor_nit.strip(), [t for t in limpios if t])

    resoluciones: list[ResolucionItem] = []
    pendientes: list[int] = []  # índices en `resoluciones` que van a Gemini

    for texto in limpios:
        if not texto:
            resoluciones.append(_sin_match(texto))
            continue

        # 1. Alias exacto del proveedor
        id_alias = alias.get(texto)
        if id_alias and id_alias in por_id:
            resoluciones.append(
                ResolucionItem(
                    texto_proveedor=texto,
                    origen="alias",
                    confianza=100,
                    candidatos=[
                        Candidato(
                            producto_empresa_id=id_alias,
                            nombre_oficial=por_id[id_alias],
                            score=100,
                        )
                    ],
                )
            )
            continue

        if not catalogo:
            resoluciones.append(_sin_match(texto))
            continue

        # 2. Fuzzy matching contra el catálogo (3 mejores candidatos)
        coincidencias = process.extract(
            texto,
            nombres,
            scorer=fuzz.WRatio,
            processor=utils.default_process,
            limit=3,
        )
        candidatos = [
            Candidato(
                producto_empresa_id=catalogo[indice]["id"],
                nombre_oficial=nombre,
                score=round(score, 1),
            )
            for nombre, score, indice in coincidencias
        ]
        if candidatos and candidatos[0].score >= config.UMBRAL_FUZZY:
            resoluciones.append(
                ResolucionItem(
                    texto_proveedor=texto,
                    origen="fuzzy",
                    confianza=candidatos[0].score,
                    candidatos=candidatos,
                )
            )
        else:
            # 3. Provisionalmente sin match; Gemini puede sobreescribirlo abajo
            resoluciones.append(_sin_match(texto))
            pendientes.append(len(resoluciones) - 1)

    if not catalogo and any(limpios):
        advertencias.append(
            "El catálogo de productos está vacío: no fue posible hacer "
            "matching difuso ni pedir sugerencias."
        )

    # 3. Sugerencia de Gemini — una sola llamada para todo el lote pendiente
    if pendientes:
        textos_pendientes = [resoluciones[i].texto_proveedor for i in pendientes]
        try:
            sugerencias = _sugerencias_gemini(textos_pendientes, nombres)
        except (
            errores_gemini.APIError,
            RuntimeError,
            json.JSONDecodeError,
            ValidationError,
        ) as exc:
            sugerencias = []
            advertencias.append(
                "No se pudo obtener la sugerencia de Gemini; los ítems dudosos "
                f"quedan sin match para resolución manual ({exc})"
            )

        sugerencia_por_texto = {s.texto.strip(): s for s in sugerencias}
        fila_por_nombre = {fila["nombre_oficial"].strip().lower(): fila for fila in catalogo}

        for posicion, indice in enumerate(pendientes):
            texto = resoluciones[indice].texto_proveedor
            sugerencia = sugerencia_por_texto.get(texto)
            if sugerencia is None and len(sugerencias) == len(pendientes):
                sugerencia = sugerencias[posicion]  # respaldo posicional
            if sugerencia is None or not sugerencia.nombre_oficial:
                continue  # 4. queda sin_match

            fila = fila_por_nombre.get(sugerencia.nombre_oficial.strip().lower())
            if fila is None:
                advertencias.append(
                    f"Gemini sugirió «{sugerencia.nombre_oficial}» para «{texto}», "
                    "pero no existe en el catálogo; queda sin match"
                )
                continue

            resoluciones[indice] = ResolucionItem(
                texto_proveedor=texto,
                origen="gemini",
                confianza=sugerencia.confianza,
                candidatos=[
                    Candidato(
                        producto_empresa_id=fila["id"],
                        nombre_oficial=fila["nombre_oficial"],
                        score=sugerencia.confianza,
                        justificacion=sugerencia.justificacion.strip() or None,
                    )
                ],
            )

    return RespuestaResolucion(resoluciones=resoluciones, advertencias=advertencias)
