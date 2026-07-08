"use client";

// Carga masiva del catálogo oficial: sube el Excel "Requisición Abastecimientos"
// (hoja Catalogo: Grupo | Codigo | Item | Unidad) al backend FastAPI y muestra
// el resumen de la sincronización (nuevos, actualizados, sin cambios, errores).
// La carga es incremental: nunca borra productos ausentes del archivo.

import { useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";

interface ErrorFila {
  fila: number;
  motivo: string;
}

interface ResumenImportacionCatalogo {
  total_filas: number;
  nuevos: number;
  actualizados: number;
  sin_cambios: number;
  errores: ErrorFila[];
  advertencias: string[];
}

export default function ImportarCatalogoPage() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacionCatalogo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function manejarEnvio(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!archivo) return;

    setCargando(true);
    setError(null);
    setResumen(null);

    const formData = new FormData();
    formData.append("archivo", archivo);

    try {
      const res = await fetchApi("/importacion/importar-catalogo", {
        method: "POST",
        body: formData,
      });
      const datos = await res.json();
      if (!res.ok) {
        setError(
          typeof datos.detail === "string"
            ? datos.detail
            : "Error al importar el archivo",
        );
        return;
      }
      setResumen(datos as ResumenImportacionCatalogo);
    } catch {
      setError("No se pudo conectar con el servidor. Verifica que el backend esté activo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <Link href="/catalogo" className="text-sm text-blue-600 hover:underline">
          ← Catálogo
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Cargar catálogo oficial</h1>
        <p className="text-sm text-gray-600 mt-1">
          Sube el Excel «Requisición Abastecimientos» (columnas: Grupo, Codigo,
          Item, Unidad). Los productos se identifican por nombre + código: los
          nuevos se crean, los existentes actualizan grupo y unidad, y nunca se
          borra ninguno.
        </p>
      </div>

      <form onSubmit={manejarEnvio} className="flex flex-col sm:flex-row gap-3 items-start">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
        />
        <button
          type="submit"
          disabled={!archivo || cargando}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cargando ? "Importando…" : "Importar"}
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {resumen && (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded border border-green-200 bg-green-50 p-4 text-center">
              <p className="text-2xl font-semibold text-green-700">{resumen.nuevos}</p>
              <p className="text-sm text-green-800">Nuevos</p>
            </div>
            <div className="rounded border border-blue-200 bg-blue-50 p-4 text-center">
              <p className="text-2xl font-semibold text-blue-700">{resumen.actualizados}</p>
              <p className="text-sm text-blue-800">Actualizados</p>
            </div>
            <div className="rounded border border-gray-200 bg-gray-50 p-4 text-center">
              <p className="text-2xl font-semibold text-gray-700">{resumen.sin_cambios}</p>
              <p className="text-sm text-gray-800">Sin cambios</p>
            </div>
            <div className="rounded border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-2xl font-semibold text-red-700">{resumen.errores.length}</p>
              <p className="text-sm text-red-800">Filas con error</p>
            </div>
          </div>

          <p className="text-sm text-gray-600">
            Se procesaron {resumen.total_filas} filas del archivo.
          </p>

          {resumen.advertencias.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4">
              <h2 className="text-sm font-semibold text-amber-800 mb-2">Advertencias</h2>
              <ul className="list-disc pl-5 text-sm text-amber-800">
                {resumen.advertencias.map((advertencia, i) => (
                  <li key={i}>{advertencia}</li>
                ))}
              </ul>
            </div>
          )}

          {resumen.errores.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-2 border-b border-gray-200 w-24">Fila</th>
                    <th className="px-4 py-2 border-b border-gray-200">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.errores.map((err) => (
                    <tr key={`${err.fila}-${err.motivo}`}>
                      <td className="px-4 py-2 border-b border-gray-100">{err.fila}</td>
                      <td className="px-4 py-2 border-b border-gray-100">{err.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
