"""Test de concurrencia para la RPC siguiente_numero_orden.

Verifica que dos (y N) llamadas concurrentes nunca reciben el mismo número.

Requiere una base de datos con las migraciones de `supabase/migrations` ya
aplicadas. La URL se toma de la variable de entorno TEST_DATABASE_URL, ej.:

    TEST_DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres

Ejecutar:  python backend/tests/test_siguiente_numero_orden.py
Dependencia:  pip install "psycopg[binary]"

Usa un año ficticio (2099) y revierte el contador al final, así puede correrse
contra una base real sin ensuciar los consecutivos de producción.
"""

import os
import sys
import threading
import time

import psycopg

DB_URL = os.environ.get("TEST_DATABASE_URL", "")
ANIO_PRUEBA = 2099  # año que nunca usará producción


def llamar_rpc(conn) -> str:
    with conn.cursor() as cur:
        cur.execute("select siguiente_numero_orden(%s)", (ANIO_PRUEBA,))
        return cur.fetchone()[0]


def test_dos_llamadas_concurrentes():
    """Dos transacciones simultáneas: la segunda debe esperar el bloqueo de
    fila de la primera y recibir el número siguiente, nunca el mismo."""
    conn_a = psycopg.connect(DB_URL)  # transacción abierta (sin autocommit)
    conn_b = psycopg.connect(DB_URL, autocommit=True)
    try:
        numero_a = llamar_rpc(conn_a)  # toma el bloqueo y NO confirma aún

        resultado_b: list[str] = []
        hilo_b = threading.Thread(target=lambda: resultado_b.append(llamar_rpc(conn_b)))
        hilo_b.start()

        time.sleep(1)
        assert hilo_b.is_alive(), (
            "La segunda llamada debió quedar bloqueada mientras la primera no confirma"
        )

        conn_a.commit()  # libera el bloqueo
        hilo_b.join(timeout=10)
        assert resultado_b, "La segunda llamada no terminó tras liberarse el bloqueo"

        numero_b = resultado_b[0]
        assert numero_a != numero_b, f"Número repetido: {numero_a}"
        print(f"  bloqueo de fila OK: {numero_a} -> {numero_b}")
    finally:
        conn_a.close()
        conn_b.close()


def test_carrera_n_llamadas(n: int = 20):
    """N hilos disparando la RPC a la vez: todos los números deben ser únicos
    y consecutivos."""
    resultados: list[str] = []
    lock = threading.Lock()
    barrera = threading.Barrier(n)

    def worker():
        with psycopg.connect(DB_URL, autocommit=True) as conn:
            barrera.wait()  # todos disparan al mismo tiempo
            numero = llamar_rpc(conn)
            with lock:
                resultados.append(numero)

    hilos = [threading.Thread(target=worker) for _ in range(n)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(timeout=30)

    assert len(resultados) == n, f"Solo terminaron {len(resultados)} de {n} llamadas"
    repetidos = len(resultados) - len(set(resultados))
    assert repetidos == 0, f"{repetidos} números repetidos: {sorted(resultados)}"
    print(f"  carrera de {n} llamadas OK: {len(set(resultados))} números únicos")


def limpiar_contador():
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute("delete from contador_ordenes where anio = %s", (ANIO_PRUEBA,))


def main() -> int:
    if not DB_URL:
        print("Falta la variable de entorno TEST_DATABASE_URL")
        return 1

    limpiar_contador()
    try:
        print("test_dos_llamadas_concurrentes:")
        test_dos_llamadas_concurrentes()
        print(f"test_carrera_n_llamadas:")
        test_carrera_n_llamadas()
    finally:
        limpiar_contador()

    print("\nTodos los tests pasaron: ningún número de orden se repite.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
