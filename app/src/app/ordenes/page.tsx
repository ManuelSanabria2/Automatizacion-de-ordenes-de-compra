"use client";

// Historial de órdenes de compra generadas (INSTRUCCIONS.MD §2.8):
// listado con número, fecha, proveedor y total, y descarga del documento
// oficial vía URL firmada por el backend.

import { useEffect, useState } from "react";
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

export default function OrdenesPage() {
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [ordenes, setOrdenes] = useState<OrdenResumen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);

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

  const claseCelda = "px-3 py-2 border-b border-gray-100";

  return (
    <main className="p-8 max-w-5xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Órdenes de compra</h1>
        <p className="text-sm text-gray-600 mt-1">
          Historial de órdenes generadas. La nueva orden se crea desde{" "}
          <Link href="/cotizaciones" className="text-blue-600 hover:underline">
            Cotizaciones
          </Link>
          . Cada orden se puede descargar en dos variantes de Excel:{" "}
          <span className="font-medium">empresa</span> (nombres del catálogo, para
          la compra interna) y <span className="font-medium">proveedor</span>{" "}
          (nombres tal como vienen en la cotización).
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {estado === "cargando" && <p className="text-sm text-gray-500">Cargando…</p>}

      {estado === "listo" && ordenes.length === 0 && (
        <p className="text-sm text-gray-600">Aún no se ha generado ninguna orden.</p>
      )}

      {estado === "listo" && ordenes.length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Número</th>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ordenes.map((orden) => (
                <tr key={orden.id} className="hover:bg-gray-50">
                  <td className={`${claseCelda} font-medium whitespace-nowrap`}>
                    {orden.numero_orden}
                  </td>
                  <td className={`${claseCelda} whitespace-nowrap`}>{orden.fecha}</td>
                  <td className={claseCelda}>
                    {orden.proveedor_nombre ?? orden.proveedor_nit ?? "—"}
                  </td>
                  <td className={`${claseCelda} text-right whitespace-nowrap`}>
                    {orden.total !== null ? formatoCOP(orden.total) : "—"}
                  </td>
                  <td className={`${claseCelda} text-right`}>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => descargar(orden, "empresa")}
                        disabled={descargando === `${orden.id}:empresa`}
                        title="Excel con los nombres del catálogo de la empresa"
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        {descargando === `${orden.id}:empresa`
                          ? "Generando…"
                          : "Excel empresa"}
                      </button>
                      <button
                        type="button"
                        onClick={() => descargar(orden, "proveedor")}
                        disabled={descargando === `${orden.id}:proveedor`}
                        title="Excel con los nombres originales de la cotización del proveedor"
                        className="rounded border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        {descargando === `${orden.id}:proveedor`
                          ? "Generando…"
                          : "Excel proveedor"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
