"use client";

// Carga masiva desde Excel. Catálogo y proveedores comparten pantalla: mismo
// flujo, mismo resumen y mismos errores por fila; solo cambian el endpoint, el
// texto de ayuda y si el resumen trae «sin cambios».

import { useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { Aviso, Boton, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";
import { Cabecera, Fila, Tabla, Td, Th } from "@/components/Tabla";

export interface ErrorFila {
  fila: number;
  motivo: string;
}

export interface ResumenImportacion {
  total_filas: number;
  nuevos: number;
  actualizados: number;
  /** Solo lo devuelve la importación del catálogo. */
  sin_cambios?: number;
  errores: ErrorFila[];
  advertencias: string[];
}

interface Props {
  volverA: { href: string; etiqueta: string };
  titulo: string;
  descripcion: React.ReactNode;
  endpoint: string;
}

export function Importador({ volverA, titulo, descripcion, endpoint }: Props) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null);
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
      const res = await fetchApi(endpoint, { method: "POST", body: formData });
      const datos = await res.json();
      if (!res.ok) {
        setError(
          typeof datos.detail === "string" ? datos.detail : "Error al importar el archivo",
        );
        return;
      }
      setResumen(datos as ResumenImportacion);
    } catch {
      setError("No se pudo conectar con el servidor. Verifica que el backend esté activo.");
    } finally {
      setCargando(false);
    }
  }

  const cifras = [
    { valor: resumen?.nuevos ?? 0, etiqueta: "Nuevos" },
    { valor: resumen?.actualizados ?? 0, etiqueta: "Actualizados" },
    ...(resumen?.sin_cambios !== undefined
      ? [{ valor: resumen.sin_cambios, etiqueta: "Sin cambios" }]
      : []),
    { valor: resumen?.errores.length ?? 0, etiqueta: "Filas con error", esError: true },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href={volverA.href} className="text-cuerpo text-acero hover:text-tinta">
          ← {volverA.etiqueta}
        </Link>
        <div className="mt-2">
          <Titulo>{titulo}</Titulo>
        </div>
        <p className="mt-2 text-cuerpo text-acero">{descripcion}</p>
      </div>

      <Tarjeta className="p-6">
        <form onSubmit={manejarEnvio} className="flex flex-col items-start gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="archivo-excel"
              className="text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase"
            >
              Archivo Excel (.xlsx)
            </label>
            <input
              id="archivo-excel"
              type="file"
              accept=".xlsx"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="text-cuerpo file:mr-3 file:rounded-suave file:border file:border-acero-claro file:bg-papel file:px-4 file:py-2 file:text-cuerpo file:text-tinta hover:file:border-acero"
            />
            {archivo && (
              <p className="text-etiqueta text-acero">Listo para importar: {archivo.name}</p>
            )}
          </div>
          <Boton type="submit" variante="principal" grande disabled={!archivo || cargando}>
            {cargando ? "Importando…" : "Importar"}
          </Boton>
        </form>
      </Tarjeta>

      {error && <Aviso tono="error">{error}</Aviso>}

      {resumen && (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cifras.map((cifra) => (
              <div
                key={cifra.etiqueta}
                className={`rounded-suave border p-4 ${
                  cifra.esError && cifra.valor > 0
                    ? "border-alto/30 bg-alto-fondo"
                    : "border-acero-claro bg-papel"
                }`}
              >
                <dd
                  className={`font-mono text-cifra leading-none font-semibold ${
                    cifra.esError && cifra.valor > 0 ? "text-alto" : "text-tinta"
                  }`}
                >
                  {cifra.valor}
                </dd>
                <dt className="mt-2 text-etiqueta text-acero">{cifra.etiqueta}</dt>
              </div>
            ))}
          </dl>

          <p className="text-cuerpo text-acero">
            Se procesaron {resumen.total_filas} filas del archivo.
          </p>

          {resumen.advertencias.length > 0 && (
            <Aviso tono="atencion" titulo="Advertencias">
              <ul className="mt-1 list-disc pl-5">
                {resumen.advertencias.map((advertencia, i) => (
                  <li key={i}>{advertencia}</li>
                ))}
              </ul>
            </Aviso>
          )}

          {resumen.errores.length > 0 && (
            <Tarjeta>
              <div className="border-b border-acero-claro px-4 py-3">
                <Etiqueta>Filas que no se pudieron importar</Etiqueta>
              </div>
              <Tabla
                descripcion="Filas del archivo que no se pudieron importar"
                ancho="32rem"
              >
                <Cabecera>
                  <Th className="w-24" numerica>
                    Fila
                  </Th>
                  <Th>Motivo</Th>
                </Cabecera>
                <tbody>
                  {resumen.errores.map((err) => (
                    <Fila key={`${err.fila}-${err.motivo}`}>
                      <Td numerica className="font-mono">
                        {err.fila}
                      </Td>
                      <Td>{err.motivo}</Td>
                    </Fila>
                  ))}
                </tbody>
              </Tabla>
            </Tarjeta>
          )}
        </div>
      )}
    </div>
  );
}
