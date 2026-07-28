"""Resolución de nombres de producto del proveedor (INSTRUCCIONS.MD §6.3 y §7).

Cascada por ítem:
1. Match exacto en `alias_productos` por (proveedor_nit, nombre_proveedor_texto).
2. Match normalizado del alias del mismo proveedor: "CEMENTO GRIS" y
   "Cemento gris" son el mismo alias aunque la tabla los guarde distinto.
3. Fuzzy multiseñal contra `productos_empresa`: score compuesto sobre el texto
   normalizado más bonificaciones por unidad y por código.
4. Si el mejor score queda bajo el umbral (`UMBRAL_FUZZY`, default 70), se pide
   a Gemini una sugerencia razonada — UNA sola llamada por lote de pendientes,
   y con una lista corta de candidatos por ítem, no con el catálogo entero.
   Si Gemini falla, se degrada a "sin_match" con una advertencia en lugar de
   fallar la petición.
5. Sin candidato aceptable → origen "sin_match" (resolución manual).

Cada resolución trae además un `nivel` (alta/media/baja) derivado de la
confianza. El nivel es informativo: **nunca se auto-confirma ni se guarda un
alias solo**; el alias se crea únicamente cuando el usuario confirma en la
pantalla de revisión.

No persiste nada. Convención: los textos del proveedor se comparan recortados
(strip) y normalizados con `app.core.texto.normalizar`.
"""

import json
from typing import Literal

from google.genai import errors as errores_gemini
from google.genai import types
from pydantic import BaseModel, Field, ValidationError
from rapidfuzz import fuzz, process

from app.core import config
from app.core.gemini import generar_contenido
from app.core.texto import extraer_medidas, normalizar, normalizar_nit
from app.services import alias_productos, catalogo_cache
from app.services.catalogo_cache import FilaCatalogo

# Confianza de un match aprendido de OTRO proveedor o de una orden anterior: es
# una decisión humana real, pero tomada en otro contexto, así que no llega al
# 100 del alias propio.
CONFIANZA_HISTORICO = 88.0

# --- Pesos del score compuesto ------------------------------------------------
# `WRatio` por sí solo satura: contra un catálogo de miles de nombres devuelve
# el mismo valor para decenas de productos sin relación, y como ese valor supera
# el umbral, la cascada acepta el primero por orden alfabético. Combinarlo con
# los scorers por tokens rompe esos empates.
PESO_TOKEN_SORT = 0.5  # compara todos los tokens: penaliza lo que sobra
PESO_TOKEN_SET = 0.3  # tolera tokens extra: capta el nombre dentro del ruido
PESO_WRATIO = 0.2  # heurística general de rapidfuzz

# Bonificaciones y penalizaciones (puntos sobre 100, el total se recorta a 100)
BONO_UNIDAD = 4.0  # la unidad del ítem coincide con la del producto
BONO_CODIGO = 25.0  # el texto del proveedor contiene el código del catálogo
BONO_MEDIDA = 8.0  # comparten alguna medida (3/8", 20 mm)
PENALIZACION_MEDIDA = 12.0  # ambos declaran medidas y ninguna coincide

# Cuántos candidatos pide cada scorer antes de fusionar. Amplio a propósito:
# esta lista es la que alimenta la shortlist de Gemini, y lo que no entre aquí
# el modelo ya no lo puede encontrar.
CANDIDATOS_POR_SCORER = 25


# --- Modelos de respuesta ----------------------------------------------------


class Candidato(BaseModel):
    producto_empresa_id: str
    nombre_oficial: str
    codigo: str | None = None  # código del catálogo oficial (distingue homónimos)
    grupo: str | None = None  # desempata homónimos con el mismo código
    score: float  # 0-100
    justificacion: str | None = None  # solo en sugerencias de Gemini


class ResolucionItem(BaseModel):
    texto_proveedor: str
    origen: Literal["alias", "historico", "fuzzy", "gemini", "sin_match"]
    nivel: Literal["alta", "media", "baja"]
    confianza: float  # 0-100 (alias=100, fuzzy=mejor score, gemini=su confianza)
    candidatos: list[Candidato]


class RespuestaResolucion(BaseModel):
    resoluciones: list[ResolucionItem]
    advertencias: list[str]


class ItemResolver(BaseModel):
    """Un ítem a resolver. `unidad` y `referencia` son señales opcionales: si el
    PDF no las trae, el matching sigue funcionando solo con el texto."""

    texto: str
    unidad: str = ""
    referencia: str = ""


class SolicitudResolucion(BaseModel):
    proveedor_nit: str = ""  # vacío: proveedor nuevo, se omite el paso de alias
    items: list[ItemResolver]


# --- Schema de la sugerencia de Gemini ---------------------------------------


class SugerenciaGemini(BaseModel):
    texto: str = ""
    nombre_oficial: str | None = None  # nombre EXACTO del catálogo, o null
    confianza: float = Field(default=0, ge=0, le=100)
    justificacion: str = ""


class RespuestaSugerencias(BaseModel):
    sugerencias: list[SugerenciaGemini] = []


# --- Utilidades ---------------------------------------------------------------


def _nivel(confianza: float) -> Literal["alta", "media", "baja"]:
    """Banda de confianza que la pantalla de revisión usa para el semáforo."""
    if confianza >= config.UMBRAL_ALTA_CONFIANZA:
        return "alta"
    if confianza >= config.UMBRAL_FUZZY:
        return "media"
    return "baja"


def _a_candidato(fila: FilaCatalogo, score: float, justificacion: str | None = None) -> Candidato:
    return Candidato(
        producto_empresa_id=fila.id,
        nombre_oficial=fila.nombre_oficial,
        codigo=fila.codigo,
        grupo=fila.grupo,
        score=round(score, 1),
        justificacion=justificacion,
    )


def _sin_match(texto: str) -> ResolucionItem:
    return ResolucionItem(
        texto_proveedor=texto, origen="sin_match", nivel="baja", confianza=0, candidatos=[]
    )


# Los lectores de alias viven en `alias_productos` (misma tabla, mismo módulo
# que las escribe). Se referencian a través del módulo para que el script de
# evaluación pueda neutralizarlos con --sin-alias.
_alias_exactos = alias_productos.alias_exactos
_alias_del_proveedor = alias_productos.alias_del_proveedor
_alias_globales = alias_productos.alias_globales
_pares_historicos = alias_productos.pares_historicos


class _Aprendido(BaseModel):
    """Índices de todo lo que el sistema ya tiene confirmado."""

    exactos: dict[str, str] = {}  # texto literal → producto (este proveedor)
    normalizados: dict[str, str] = {}  # texto normalizado → producto (este proveedor)
    por_referencia: dict[str, str] = {}  # referencia → producto (este proveedor)
    globales: dict[str, str] = {}  # texto normalizado → producto (otros proveedores)
    historicos: dict[str, str] = {}  # texto normalizado → producto (órdenes emitidas)

    def buscar(
        self, texto: str, texto_norm: str, referencia: str
    ) -> tuple[str, str, float] | None:
        """(producto_id, origen, confianza) o None. De mayor a menor evidencia:
        lo que confirmó este proveedor manda sobre lo que se confirmó para otro."""
        for indice, clave in (
            (self.exactos, texto),
            (self.normalizados, texto_norm),
            (self.por_referencia, referencia.strip().lower()),
        ):
            if clave and (producto_id := indice.get(clave)):
                return producto_id, "alias", 100.0

        for indice in (self.historicos, self.globales):
            if texto_norm and (producto_id := indice.get(texto_norm)):
                return producto_id, "historico", CONFIANZA_HISTORICO
        return None


# --- Fuzzy multiseñal ---------------------------------------------------------


def _preseleccionar(texto_norm: str, nombres_norm: list[str]) -> set[int]:
    """Índices candidatos según varios scorers, unidos para maximizar el recall.

    Cada scorer falla de forma distinta: `token_set_ratio` premia al que contiene
    todos los tokens, `partial_ratio` al que comparte una subcadena larga y
    `WRatio` mezcla ambos. La unión evita que el producto correcto quede fuera
    solo por el sesgo de un scorer.
    """
    indices: set[int] = set()
    for scorer in (fuzz.token_set_ratio, fuzz.token_sort_ratio, fuzz.WRatio, fuzz.partial_ratio):
        for _, _, indice in process.extract(
            texto_norm, nombres_norm, scorer=scorer, limit=CANDIDATOS_POR_SCORER
        ):
            indices.add(indice)
    return indices


def _score_compuesto(
    texto_norm: str, medidas_texto: frozenset[str], item: ItemResolver, fila: FilaCatalogo
) -> float:
    """Score 0-100 de un producto para un ítem, con todas las señales."""
    nombre = fila.nombre_normalizado
    score = (
        PESO_TOKEN_SORT * fuzz.token_sort_ratio(texto_norm, nombre)
        + PESO_TOKEN_SET * fuzz.token_set_ratio(texto_norm, nombre)
        + PESO_WRATIO * fuzz.WRatio(texto_norm, nombre)
    )

    # La medida distingue productos cuyos nombres se parecen en un 97 %
    # (codo de 3/8" vs codo de 3/4"). Si ninguno de los dos la declara, no hay
    # señal y no se toca el score.
    if medidas_texto and fila.medidas:
        if medidas_texto & fila.medidas:
            score += BONO_MEDIDA
        else:
            score -= PENALIZACION_MEDIDA

    unidad_item = normalizar(item.unidad)
    if unidad_item and unidad_item == fila.unidad_normalizada:
        score += BONO_UNIDAD

    # El proveedor suele anteponer su propia referencia, pero a veces usa el
    # código de la empresa; si aparece literal, es una señal muy fuerte.
    if fila.codigo and fila.codigo.strip() and fila.codigo.strip().lower() in texto_norm:
        score += BONO_CODIGO

    return min(score, 100.0)


def _candidatos_fuzzy(
    item: ItemResolver, catalogo: list[FilaCatalogo], nombres_norm: list[str], limite: int
) -> list[Candidato]:
    """Los `limite` mejores productos para el ítem, ya ordenados."""
    texto_norm = normalizar(item.texto)
    if not texto_norm:
        return []

    medidas_texto = extraer_medidas(texto_norm)
    puntuados = [
        (
            # Que el texto normalizado sea IDÉNTICO al nombre del catálogo es la
            # señal más fuerte que existe y manda sobre el score: sin esto, un
            # "TAPON MACHO GALVANIZADO 1 1/2" empata en 100 con el "TAPON MACHO
            # HG 1/2" que sí es el mismo producto, y desempata el alfabeto.
            texto_norm == catalogo[indice].nombre_normalizado,
            _score_compuesto(texto_norm, medidas_texto, item, catalogo[indice]),
            indice,
        )
        for indice in _preseleccionar(texto_norm, nombres_norm)
    ]
    puntuados.sort(key=lambda t: (not t[0], -t[1], catalogo[t[2]].nombre_oficial))
    return [
        _a_candidato(catalogo[indice], max(score, 0.0))
        for _exacto, score, indice in puntuados[:limite]
    ]


# --- Sugerencias de Gemini ----------------------------------------------------


def _prompt_sugerencias(pendientes: list[tuple[ItemResolver, list[Candidato]]]) -> str:
    """Prompt con una lista corta de opciones POR ÍTEM.

    Antes se volcaba el catálogo completo (>2000 nombres) en cada llamada: mucho
    ruido para el modelo y un gasto de tokens que crecía con el catálogo.
    """
    bloques = [
        {
            "texto": item.texto,
            "unidad": item.unidad,
            "referencia": item.referencia,
            "opciones": [
                {
                    "nombre_oficial": c.nombre_oficial,
                    "codigo": c.codigo,
                    "grupo": c.grupo,
                }
                for c in candidatos
            ],
        }
        for item, candidatos in pendientes
    ]
    return (
        "Eres un asistente que reconcilia nombres de productos escritos por un "
        "proveedor con el catálogo oficial interno de una empresa en Colombia.\n\n"
        "Para cada texto del proveedor te doy una lista corta de opciones del "
        "catálogo. Elige la que designa el MISMO producto (misma naturaleza y "
        "especificación: material, diámetro, medida).\n\n"
        + json.dumps(bloques, ensure_ascii=False)
        + "\n\nDevuelve ÚNICAMENTE un JSON con la clave \"sugerencias\": una lista "
        "con UN objeto por cada texto del proveedor, en el mismo orden, con las "
        "claves:\n"
        '- "texto": el texto del proveedor tal cual.\n'
        '- "nombre_oficial": el "nombre_oficial" EXACTO de una de las opciones '
        "de ESE texto, o null si ninguna corresponde o dudas entre varias. No "
        "inventes nombres que no estén en las opciones.\n"
        '- "confianza": número de 0 a 100.\n'
        '- "justificacion": una frase breve explicando la elección.\n'
    )


def _sugerencias_gemini(
    pendientes: list[tuple[ItemResolver, list[Candidato]]],
) -> list[SugerenciaGemini]:
    respuesta = generar_contenido(
        contents=_prompt_sugerencias(pendientes),
        config_generacion=types.GenerateContentConfig(
            temperature=0,
            response_mime_type="application/json",
            response_schema=RespuestaSugerencias,
        ),
    )
    if not respuesta.text:
        raise RuntimeError("Gemini devolvió una respuesta vacía")
    return RespuestaSugerencias.model_validate(json.loads(respuesta.text)).sugerencias


# --- Cascada completa ---------------------------------------------------------


def resolver_productos(
    proveedor_nit: str, items: list[ItemResolver | str]
) -> RespuestaResolucion:
    advertencias: list[str] = []
    # Tolera la forma antigua (lista de textos) para no romper llamadores viejos.
    limpios = [
        ItemResolver(texto=(it or "").strip()) if isinstance(it, str)
        else it.model_copy(update={"texto": (it.texto or "").strip()})
        for it in items
    ]

    catalogo = catalogo_cache.obtener_catalogo()
    nombres_norm = [fila.nombre_normalizado for fila in catalogo]
    por_id = {fila.id: fila for fila in catalogo}

    nit = normalizar_nit(proveedor_nit)
    textos = [it.texto for it in limpios if it.texto]
    normalizados, por_referencia = _alias_del_proveedor(nit)
    aprendido = _Aprendido(
        exactos=_alias_exactos(nit, textos),
        normalizados=normalizados,
        por_referencia=por_referencia,
        globales=_alias_globales(nit),
        historicos=_pares_historicos(),
    )

    resoluciones: list[ResolucionItem] = []
    pendientes: list[int] = []  # índices en `resoluciones` que van a Gemini

    for item in limpios:
        texto = item.texto
        if not texto:
            resoluciones.append(_sin_match(texto))
            continue

        # 1. Lo ya confirmado: alias del proveedor (exacto, normalizado o por
        #    referencia), luego órdenes anteriores y alias de otros proveedores.
        encontrado = aprendido.buscar(texto, normalizar(texto), item.referencia)
        if encontrado and encontrado[0] in por_id:
            producto_id, origen, confianza = encontrado
            resoluciones.append(
                ResolucionItem(
                    texto_proveedor=texto,
                    origen=origen,
                    nivel=_nivel(confianza),
                    confianza=confianza,
                    candidatos=[_a_candidato(por_id[producto_id], confianza)],
                )
            )
            continue

        if not catalogo:
            resoluciones.append(_sin_match(texto))
            continue

        # 3. Fuzzy multiseñal contra el catálogo
        candidatos = _candidatos_fuzzy(item, catalogo, nombres_norm, config.MAX_CANDIDATOS)
        if candidatos and candidatos[0].score >= config.UMBRAL_FUZZY:
            resoluciones.append(
                ResolucionItem(
                    texto_proveedor=texto,
                    origen="fuzzy",
                    nivel=_nivel(candidatos[0].score),
                    confianza=candidatos[0].score,
                    candidatos=candidatos,
                )
            )
        else:
            # 4. Provisionalmente sin match; Gemini puede sobreescribirlo abajo
            resoluciones.append(_sin_match(texto))
            pendientes.append(len(resoluciones) - 1)

    if not catalogo and any(it.texto for it in limpios):
        advertencias.append(
            "El catálogo de productos está vacío: no fue posible hacer "
            "matching difuso ni pedir sugerencias."
        )

    # 4. Sugerencia de Gemini — una sola llamada para todo el lote pendiente
    if pendientes:
        # Shortlist amplia por ítem: es lo único que Gemini podrá elegir. El
        # presupuesto la encoge cuando hay muchos pendientes, para que el prompt
        # no acabe siendo más grande que el catálogo que se quería evitar.
        por_item = max(
            config.MIN_SHORTLIST_GEMINI,
            min(
                config.TAMANO_SHORTLIST_GEMINI,
                config.PRESUPUESTO_OPCIONES_GEMINI // len(pendientes),
            ),
        )
        shortlists = {
            indice: _candidatos_fuzzy(limpios[indice], catalogo, nombres_norm, por_item)
            for indice in pendientes
        }
        lote = [(limpios[indice], shortlists[indice]) for indice in pendientes]

        try:
            sugerencias = _sugerencias_gemini(lote)
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

        for posicion, indice in enumerate(pendientes):
            texto = resoluciones[indice].texto_proveedor
            sugerencia = sugerencia_por_texto.get(texto)
            if sugerencia is None and len(sugerencias) == len(pendientes):
                sugerencia = sugerencias[posicion]  # respaldo posicional
            if sugerencia is None or not sugerencia.nombre_oficial:
                # 5. queda sin_match, pero con la shortlist como alternativas
                resoluciones[indice] = ResolucionItem(
                    texto_proveedor=texto,
                    origen="sin_match",
                    nivel="baja",
                    confianza=0,
                    candidatos=shortlists[indice][: config.MAX_CANDIDATOS],
                )
                continue

            # El nombre debe ser uno de los que se le ofrecieron a ESE ítem:
            # así no puede inventar productos ni traer uno de otro ítem.
            elegido = sugerencia.nombre_oficial.strip().lower()
            candidato = next(
                (c for c in shortlists[indice] if c.nombre_oficial.strip().lower() == elegido),
                None,
            )
            if candidato is None:
                advertencias.append(
                    f"Gemini sugirió «{sugerencia.nombre_oficial}» para «{texto}», "
                    "que no estaba entre las opciones ofrecidas; queda sin match"
                )
                resoluciones[indice] = ResolucionItem(
                    texto_proveedor=texto,
                    origen="sin_match",
                    nivel="baja",
                    confianza=0,
                    candidatos=shortlists[indice][: config.MAX_CANDIDATOS],
                )
                continue

            # El elegido primero, y detrás el resto de la shortlist como
            # alternativas a un clic en la pantalla de revisión.
            resto = [c for c in shortlists[indice] if c is not candidato]
            resoluciones[indice] = ResolucionItem(
                texto_proveedor=texto,
                origen="gemini",
                nivel=_nivel(sugerencia.confianza),
                confianza=sugerencia.confianza,
                candidatos=[
                    candidato.model_copy(
                        update={
                            "score": sugerencia.confianza,
                            "justificacion": sugerencia.justificacion.strip() or None,
                        }
                    ),
                    *resto[: config.MAX_CANDIDATOS - 1],
                ],
            )

    return RespuestaResolucion(resoluciones=resoluciones, advertencias=advertencias)
