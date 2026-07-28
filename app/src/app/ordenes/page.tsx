"use client";

// Historial de órdenes de compra generadas (INSTRUCCIONS.MD §2.8):
// listado con número, fecha, proveedor y total, y descarga del documento
// oficial vía URL firmada por el backend.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  descargarDocumentoOrden,
  ERROR_CONEXION,
  extraerDetalle,
  fetchApi,
  formatoCOP,
  OrdenResumen,
  VarianteDocumento,
} from "@/lib/api";
import { Aviso, Boton, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";
import { Campo } from "@/components/Campo";
import { Cabecera, Fila, Tabla, Td, Th, Vacio } from "@/components/Tabla";
import { filtrar } from "@/lib/fuzzy";

export default function OrdenesPage() {
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetchApi("/ordenes");
        if (cancelado) return;
        if (!res.ok) {
          setError(await extraerDetalle(res, "Error al cargar el historial"));
          setEstado("error");
          return;
        }
        setOrdenes((await res.json()) as OrdenResumen[]);
        setEstado("listo");
      } catch {
        if (!cancelado) {
          setError(ERROR_CONEXION);
          setEstado("error");
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  // El historial cabe entero en memoria: filtrar aquí es instantáneo y evita
  // un endpoint de búsqueda que no existe.
  const visibles = useMemo(
    () =>
      filtrar(
        ordenes,
        buscar,
        (o) => o.numero_orden,
        (o) => `${o.proveedor_nombre ?? ""} ${o.proveedor_nit ?? ""} ${o.fecha}`,
        500,
      ).map((r) => r.opcion),
    [ordenes, buscar],
  );

  // Clave de estado por (orden, variante) para que solo el botón pulsado
  // muestre "Generando…".
  async function descargar(orden: OrdenResumen, variante: VarianteDocumento) {
    const clave = `${orden.id}:${variante}`;
    setDescargando(clave);
    setError(null);
    const nombre = `${orden.numero_orden} - ${variante}.xlsx`;
    const mensaje = await descargarDocumentoOrden(orden.id, variante, nombre);
    if (mensaje) setError(mensaje);
    setDescargando(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Titulo>Órdenes de compra</Titulo>
        <p className="mt-2 max-w-3xl text-cuerpo text-acero">
          Historial de órdenes generadas. La nueva orden se crea desde{" "}
          <Link href="/cotizaciones" className="text-tinta underline underline-offset-4">
            Cotizaciones
          </Link>
          . Cada orden se puede descargar en dos variantes de Excel:{" "}
          <span className="text-tinta">empresa</span> (nombres del catálogo, para la compra
          interna) y <span className="text-tinta">proveedor</span> (nombres tal como vienen
          en la cotización).
        </p>
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {estado === "cargando" && <p className="text-cuerpo text-acero">Cargando…</p>}

      {estado === "listo" && ordenes.length === 0 && (
        <Tarjeta className="p-6">
          <p className="text-cuerpo text-acero">Aún no se ha generado ninguna orden.</p>
        </Tarjeta>
      )}

      {estado === "listo" && ordenes.length > 0 && (
        <>
          <div className="max-w-md">
            <Campo
              etiqueta="Buscar orden"
              type="search"
              placeholder="Número de orden, proveedor o fecha…"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </div>

          <Tarjeta>
            <div className="border-b border-acero-claro px-4 py-3">
              <Etiqueta>
                {buscar.trim()
                  ? `${visibles.length} de ${ordenes.length} órdenes`
                  : `${ordenes.length} ${ordenes.length === 1 ? "orden" : "órdenes"}`}
              </Etiqueta>
            </div>

            {visibles.length === 0 ? (
              <p className="px-4 py-6 text-cuerpo text-acero">
                Ninguna orden coincide con la búsqueda.
              </p>
            ) : (
              <Tabla
                descripcion="Órdenes de compra generadas, con su número, fecha, proveedor y total"
                ancho="54rem"
              >
                <Cabecera>
                  <Th className="w-56">Número</Th>
                  <Th className="w-32">Fecha</Th>
                  <Th>Proveedor</Th>
                  <Th className="w-40" numerica>
                    Total
                  </Th>
                  <Th className="w-72" />
                </Cabecera>
                <tbody>
                  {visibles.map((orden) => (
                    <Fila key={orden.id}>
                      <Td className="font-mono font-medium whitespace-nowrap">
                        {orden.numero_orden}
                      </Td>
                      <Td className="font-mono whitespace-nowrap text-acero">{orden.fecha}</Td>
                      <Td>{orden.proveedor_nombre ?? orden.proveedor_nit ?? <Vacio />}</Td>
                      <Td numerica className="font-mono whitespace-nowrap">
                        {orden.total !== null ? formatoCOP(orden.total) : <Vacio />}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          <Boton
                            onClick={() => descargar(orden, "empresa")}
                            disabled={descargando === `${orden.id}:empresa`}
                            title="Excel con los nombres del catálogo de la empresa"
                            className="whitespace-nowrap"
                          >
                            {descargando === `${orden.id}:empresa`
                              ? "Generando…"
                              : "Excel empresa"}
                          </Boton>
                          <Boton
                            onClick={() => descargar(orden, "proveedor")}
                            disabled={descargando === `${orden.id}:proveedor`}
                            title="Excel con los nombres originales de la cotización del proveedor"
                            className="whitespace-nowrap"
                          >
                            {descargando === `${orden.id}:proveedor`
                              ? "Generando…"
                              : "Excel proveedor"}
                          </Boton>
                        </div>
                      </Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            )}
          </Tarjeta>
        </>
      )}
    </div>
  );
}
