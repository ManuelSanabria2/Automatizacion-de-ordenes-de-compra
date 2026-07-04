"""Cliente Supabase compartido del backend (service_role, salta RLS).

La creación es perezosa (lru_cache) para que importar el módulo no falle
cuando el entorno aún no está configurado.
"""

from functools import lru_cache

from supabase import Client, create_client

from app.core import config


@lru_cache(maxsize=1)
def obtener_cliente() -> Client:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno (.env)"
        )
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
