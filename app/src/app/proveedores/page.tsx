"use client";

// Módulo de proveedores: listado con búsqueda por nombre o NIT, e importación
// masiva desde Excel. Los proveedores se crean al generar una orden con un NIT
// nuevo o desde la carga masiva; aquí solo se consultan.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ERROR_CONEXION, extraerDetalle, fetchApi, type Proveedor } from "@/lib/api";
import { Campo } from "@/components/Campo";
import { Aviso, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";
import { Cabecera, Fila, Tabla, Td, Th, Vacio } from "@/components/Tabla";

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscar, setBuscar] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mismo patrón que el catálogo: se espera a que el usuario deje de teclear y
  // se cancela la petición anterior, para no encadenar respuestas fuera de orden.
  useEffect(() => {
    const controlador = new AbortController();
    const termino = buscar.trim();
    const temporizador = setTimeout(async () => {
      setCargando(true);
      setError(null);
      try {
        const consulta = termino ? `?buscar=${encodeURIComponent(termino)}` : "";
        const res = await fetchApi(`/proveedores${consulta}`, {
          signal: controlador.signal,
        });
        if (!res.ok) {
          setError(await extraerDetalle(res, "Error al cargar los proveedores"));
          return;
        }
        setProveedores((await res.json()) as Proveedor[]);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(ERROR_CONEXION);
        }
      } finally {
        if (!controlador.signal.aborted) setCargando(false);
      }
    }, 300);

    return () => {
      controlador.abort();
      clearTimeout(temporizador);
    };
  }, [buscar]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Titulo>Proveedores</Titulo>
          <p className="mt-2 max-w-2xl text-cuerpo text-acero">
            Proveedores registrados. Se crean al generar una orden con un NIT nuevo o mediante
            la carga masiva desde Excel.
          </p>
        </div>
        <Link
          href="/proveedores/importar"
          className="shrink-0 rounded-suave border border-tinta bg-tinta px-4 py-2 text-cuerpo font-medium text-papel hover:bg-tinta/90"
        >
          Importar desde Excel
        </Link>
      </div>

      <div className="max-w-md">
        <Campo
          etiqueta="Buscar por nombre o NIT"
          type="search"
          placeholder="Buscar por nombre o NIT…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      {cargando ? (
        <p className="text-cuerpo text-acero">Cargando…</p>
      ) : proveedores.length === 0 && !error ? (
        <Tarjeta className="p-6">
          <p className="text-cuerpo text-acero">
            {buscar.trim()
              ? "Ningún proveedor coincide con la búsqueda."
              : "Aún no hay proveedores registrados. Impórtalos desde Excel."}
          </p>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <div className="border-b border-acero-claro px-4 py-3">
            <Etiqueta>
              {buscar.trim()
                ? `${proveedores.length} coinciden con «${buscar.trim()}»`
                : `${proveedores.length} proveedores registrados`}
            </Etiqueta>
          </div>
          <Tabla
            descripcion="Proveedores registrados con su NIT y datos de contacto"
            ancho="50rem"
          >
            <Cabecera>
              <Th className="w-40">NIT</Th>
              <Th>Nombre</Th>
              <Th className="w-40">Ciudad</Th>
              <Th className="w-44">Contacto</Th>
              <Th className="w-36">Teléfono</Th>
            </Cabecera>
            <tbody>
              {proveedores.map((proveedor) => (
                <Fila key={proveedor.nit}>
                  <Td className="font-mono whitespace-nowrap">{proveedor.nit}</Td>
                  <Td>{proveedor.nombre}</Td>
                  <Td className="text-acero">{proveedor.ciudad ?? <Vacio />}</Td>
                  <Td className="text-acero">{proveedor.contacto ?? <Vacio />}</Td>
                  <Td className="font-mono text-acero">{proveedor.telefono ?? <Vacio />}</Td>
                </Fila>
              ))}
            </tbody>
          </Tabla>
        </Tarjeta>
      )}
    </div>
  );
}
