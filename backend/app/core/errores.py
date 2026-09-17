"""Red de seguridad para las excepciones que ningún router captura.

Sin esto, una excepción no manejada sale por el ServerErrorMiddleware de
Starlette, que está POR ENCIMA del CORSMiddleware: la respuesta 500 viaja sin
cabeceras CORS y el navegador reporta "No 'Access-Control-Allow-Origin'
header", escondiendo el error real. Este middleware se monta por debajo del de
CORS (se añade antes en main.py), así que su respuesta sí las recibe.
"""

import logging

import httpx
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("uvicorn.error")

MENSAJE_SIN_BASE_DE_DATOS = (
    "No hay conexión con la base de datos. Si el proyecto de Supabase está "
    "pausado por inactividad, hay que reactivarlo desde el panel de Supabase."
)
MENSAJE_GENERICO = (
    "Error interno del servidor. El detalle quedó en los logs del backend."
)


class CapturaErrores:
    """Middleware ASGI puro — no usa BaseHTTPMiddleware para no interferir con
    las respuestas en streaming (la descarga de órdenes)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        iniciada = False

        async def send_observado(message: Message) -> None:
            nonlocal iniciada
            if message["type"] == "http.response.start":
                iniciada = True
            await send(message)

        try:
            await self.app(scope, receive, send_observado)
        except Exception as exc:
            logger.exception(
                "Error no manejado en %s %s",
                scope.get("method", "?"),
                scope.get("path", "?"),
            )
            # Si ya se enviaron cabeceras no se puede reemplazar la respuesta:
            # se propaga y que Starlette corte la conexión.
            if iniciada:
                raise
            # httpx.TransportError cubre ConnectError, ReadTimeout, etc.: la
            # petición ni siquiera llegó a Supabase/Gemini.
            if isinstance(exc, httpx.TransportError):
                respuesta = JSONResponse(
                    status_code=503, content={"detail": MENSAJE_SIN_BASE_DE_DATOS}
                )
            else:
                respuesta = JSONResponse(
                    status_code=500, content={"detail": MENSAJE_GENERICO}
                )
            await respuesta(scope, receive, send)
