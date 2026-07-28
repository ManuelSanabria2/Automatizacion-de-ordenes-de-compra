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
import { Aviso, Boton, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";

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

  // El proceso tarda: decir en qué paso va evita que se piense que se colgó.
  const PASOS = [
    { clave: "extrayendo", texto: "Leyendo el PDF" },
    { clave: "resolviendo", texto: "Buscando cada ítem en el catálogo" },
  ] as const;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Titulo>Nueva cotización</Titulo>
        <p className="mt-2 text-cuerpo text-acero">
          Sube el PDF de la cotización del proveedor. El sistema extrae los ítems, los
          reconcilia con el catálogo y te lleva a la pantalla de revisión.
        </p>
      </div>

      <Tarjeta className="p-6">
        <form onSubmit={manejarEnvio} className="flex flex-col items-start gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pdf-cotizacion"
              className="text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase"
            >
              Archivo PDF de la cotización
            </label>
            <input
              id="pdf-cotizacion"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="text-cuerpo file:mr-3 file:rounded-suave file:border file:border-acero-claro file:bg-papel file:px-4 file:py-2 file:text-cuerpo file:text-tinta hover:file:border-acero"
            />
            {archivo && (
              <p className="text-etiqueta text-acero">Listo para procesar: {archivo.name}</p>
            )}
          </div>

          <Boton type="submit" variante="principal" grande disabled={!archivo || fase !== null}>
            {fase === "extrayendo"
              ? "Extrayendo con Gemini…"
              : fase === "resolviendo"
                ? "Resolviendo productos…"
                : "Procesar cotización"}
          </Boton>
        </form>
      </Tarjeta>

      {fase !== null && (
        <Tarjeta className="p-6">
          <Etiqueta>Procesando</Etiqueta>
          <ol className="mt-3 flex flex-col gap-2">
            {PASOS.map((paso) => {
              const hecho = fase === "resolviendo" && paso.clave === "extrayendo";
              const enCurso = fase === paso.clave;
              return (
                <li
                  key={paso.clave}
                  className={`flex items-center gap-3 text-cuerpo ${
                    hecho ? "text-listo" : enCurso ? "text-tinta" : "text-acero"
                  }`}
                >
                  <span aria-hidden>{hecho ? "✓" : enCurso ? "→" : "·"}</span>
                  {paso.texto}
                  {enCurso && <span className="text-acero">…</span>}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-etiqueta text-acero">
            Puede tardar hasta un minuto según el tamaño de la cotización.
          </p>
        </Tarjeta>
      )}

      {error && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
