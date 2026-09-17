"""Cliente Gemini compartido del backend.

La creación es perezosa (lru_cache) para que importar el módulo no falle
cuando el entorno aún no está configurado.
"""

import logging
import random
import time
from functools import lru_cache

from google import genai
from google.genai import errors, types

from app.core import config

logger = logging.getLogger("uvicorn.error")

# Errores transitorios de la API: sobrecarga del modelo (503 "overloaded"),
# cuota agotada (429) y fallos internos. Se reintenta antes de propagar.
CODIGOS_TRANSITORIOS = {429, 500, 503, 504}

# Códigos que significan "este modelo no sirve, prueba el siguiente" sin
# gastar reintentos: no existe, no está habilitado para la key, o la key no
# tiene permiso sobre él.
CODIGOS_CAMBIO_DE_MODELO = {403, 404}

INTENTOS_POR_MODELO = 3
ESPERA_BASE_SEGUNDOS = 2.0
ESPERA_MAXIMA_SEGUNDOS = 30.0

# Techo de tiempo que puede gastarse TODA la cascada en esperas. Sin esto, tres
# modelos × tres intentos con un retryDelay alto dejarían la petición colgada
# varios minutos y el navegador cortaría antes de recibir la respuesta.
PRESUPUESTO_ESPERA_SEGUNDOS = 60.0


@lru_cache(maxsize=1)
def obtener_cliente() -> genai.Client:
    if not config.GEMINI_API_KEY:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno (.env)")
    return genai.Client(api_key=config.GEMINI_API_KEY)


def _modelos() -> list[str]:
    """Modelo principal seguido de los de respaldo, sin repetidos."""
    ordenados = [config.GEMINI_MODEL, *config.GEMINI_MODELOS_RESPALDO]
    vistos: list[str] = []
    for modelo in ordenados:
        if modelo and modelo not in vistos:
            vistos.append(modelo)
    return vistos


def _retraso_sugerido(exc: errors.APIError) -> float | None:
    """Segundos del RetryInfo que Gemini adjunta a los 429, si viene.

    La respuesta trae `details: [{"@type": ".../google.rpc.RetryInfo",
    "retryDelay": "27s"}]`. Esperar lo que pide la API evita quemar los
    reintentos antes de que la cuota se libere.
    """
    detalles = getattr(exc, "details", None)
    if not isinstance(detalles, dict):
        return None
    lista = detalles.get("error", {}).get("details")
    if not isinstance(lista, list):
        return None
    for entrada in lista:
        if not isinstance(entrada, dict):
            continue
        valor = entrada.get("retryDelay")
        if isinstance(valor, str) and valor.endswith("s"):
            try:
                return float(valor[:-1])
            except ValueError:
                continue
    return None


def _espera(exc: errors.APIError, intento: int) -> float:
    """Backoff exponencial con jitter, acotado, y con prioridad al RetryInfo."""
    sugerido = _retraso_sugerido(exc)
    base = sugerido if sugerido is not None else ESPERA_BASE_SEGUNDOS * 2**intento
    # El jitter evita que varios usuarios reintenten en el mismo instante.
    return min(base, ESPERA_MAXIMA_SEGUNDOS) + random.uniform(0, 1)


def generar_contenido(
    contents, config_generacion: types.GenerateContentConfig
) -> types.GenerateContentResponse:
    """generate_content con reintentos y cascada de modelos.

    Recorre GEMINI_MODEL y luego GEMINI_MODELOS_RESPALDO. Con cada modelo
    reintenta hasta INTENTOS_POR_MODELO veces ante un error transitorio
    (429/500/503/504, p. ej. "high demand"), esperando lo que pida el
    RetryInfo de la API o, en su defecto, 2 s / 4 s con jitter. Agotado un
    modelo, pasa al siguiente: es raro que todos estén saturados a la vez.
    Cualquier otro error se propaga de inmediato.
    """
    modelos = _modelos()
    if not modelos:
        raise RuntimeError("Falta GEMINI_MODEL en el entorno (.env)")
    ultimo_error: errors.APIError | None = None
    espera_acumulada = 0.0

    for modelo in modelos:
        for intento in range(INTENTOS_POR_MODELO):
            try:
                return obtener_cliente().models.generate_content(
                    model=modelo,
                    contents=contents,
                    config=config_generacion,
                )
            except errors.APIError as exc:
                ultimo_error = exc
                if exc.code in CODIGOS_CAMBIO_DE_MODELO:
                    logger.warning(
                        "Gemini: modelo %s no disponible (%s), se pasa al siguiente",
                        modelo,
                        exc.code,
                    )
                    break
                if exc.code not in CODIGOS_TRANSITORIOS:
                    raise
                if intento == INTENTOS_POR_MODELO - 1:
                    logger.warning(
                        "Gemini: %s agotó sus %s intentos (%s), se pasa al siguiente",
                        modelo,
                        INTENTOS_POR_MODELO,
                        exc.code,
                    )
                    break
                espera = _espera(exc, intento)
                if espera_acumulada + espera > PRESUPUESTO_ESPERA_SEGUNDOS:
                    logger.warning(
                        "Gemini: presupuesto de espera agotado en %s, "
                        "se pasa al siguiente modelo",
                        modelo,
                    )
                    break
                espera_acumulada += espera
                logger.warning(
                    "Gemini: error transitorio %s en %s, reintento %s/%s en %.1fs",
                    exc.code,
                    modelo,
                    intento + 2,
                    INTENTOS_POR_MODELO,
                    espera,
                )
                time.sleep(espera)

    assert ultimo_error is not None, "el bucle solo sale por return o por error"
    logger.error(
        "Gemini: todos los modelos fallaron (%s): %s",
        ", ".join(modelos),
        ultimo_error.code,
    )
    raise ultimo_error
