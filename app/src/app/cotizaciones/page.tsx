"use client";

// Subida del PDF de cotización: extrae los datos vía backend (Gemini),
// resuelve los nombres de producto contra el catálogo y pasa el resultado
// a la pantalla de revisión (/cotizaciones/revisar) vía sessionStorage.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLAVE_REVISION,
  CotizacionExtraida,
  ERROR_CONEXION,
  extraerDetalle,
  fetchApi,
  ItemResolver,
  RespuestaResolucion,
  RevisionPendiente,
} from "@/lib/api";
import { guardarPdfCotizacion } from "@/lib/pdf-cotizacion";

type Fase = "extrayendo" | "resolviendo" | null;

export default function CotizacionesPage() {
  const router = useRouter();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [fase, setFase] = useState<Fase>(null);
  const [error, setError] = useState<string | null>(null);

  async function manejarEnvio(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!archivo) return;
    setError(null);

    try {
      setFase("extrayendo");
      const formData = new FormData();
      formData.append("archivo", archivo);
      const resExtraccion = await fetchApi("/extraccion/extraer-cotizacion", {
        method: "POST",
        body: formData,
      });
      if (!resExtraccion.ok) {
        setError(await extraerDetalle(resExtraccion, "Error al extraer la cotización"));
        return;
      }
      const cotizacion = (await resExtraccion.json()) as CotizacionExtraida;

      setFase("resolviendo");
      const resResolucion = await fetchApi("/extraccion/resolver-productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_nit: cotizacion.proveedor.nit,
          // La unidad y la referencia del proveedor son señales extra del matching.
          items: cotizacion.items.map(
            (item): ItemResolver => ({
              texto: item.descripcion,
              unidad: item.unidad ?? "",
              referencia: item.referencia ?? "",
            }),
          ),
        }),
      });
      if (!resResolucion.ok) {
        setError(await extraerDetalle(resResolucion, "Error al resolver los productos"));
        return;
      }
      const resolucion = (await resResolucion.json()) as RespuestaResolucion;

      const revision: RevisionPendiente = {
        cotizacion,
        resolucion,
        nombreArchivo: archivo.name,
      };
      sessionStorage.setItem(CLAVE_REVISION, JSON.stringify(revision));
      // El PDF original viaja en memoria: se adjunta a Storage al generar la orden.
      guardarPdfCotizacion(archivo);
      router.push("/cotizaciones/revisar");
    } catch {
      setError(ERROR_CONEXION);
    } finally {
      setFase(null);
    }
  }

  return (
    <main className="p-8 max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Nueva cotización</h1>
        <p className="text-sm text-gray-600 mt-1">
          Sube el PDF de la cotización del proveedor. El sistema extrae los ítems,
          los reconcilia con el catálogo y te lleva a la pantalla de revisión.
        </p>
      </div>

      <form onSubmit={manejarEnvio} className="flex flex-col sm:flex-row gap-3 items-start">
        <input
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <button
          type="submit"
          disabled={!archivo || fase !== null}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {fase === "extrayendo"
            ? "Extrayendo con Gemini…"
            : fase === "resolviendo"
              ? "Resolviendo productos…"
              : "Procesar cotización"}
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
    </main>
  );
}
