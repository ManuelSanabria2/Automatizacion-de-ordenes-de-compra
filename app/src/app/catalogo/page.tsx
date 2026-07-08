"use client";

// Catálogo de productos oficiales de la empresa: listar, buscar por nombre o
// código, crear y editar. Es espejo del Excel "Requisición Abastecimientos"
// (mismo nombre, código y grupo). Los alias por proveedor se gestionan aparte.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ERROR_CONEXION, extraerDetalle, fetchApi } from "@/lib/api";

interface Producto {
  id: string;
  nombre_oficial: string;
  codigo: string | null;
  grupo: string | null;
  unidad_default: string | null;
  tasa_iva_default: number;
}

interface FormularioProducto {
  nombre: string;
  codigo: string;
  grupo: string;
  unidad: string;
  tasaIva: string;
}

const FORMULARIO_VACIO: FormularioProducto = {
  nombre: "",
  codigo: "",
  grupo: "",
  unidad: "",
  tasaIva: "19",
};

function cuerpoProducto(form: FormularioProducto) {
  return {
    nombre_oficial: form.nombre.trim(),
    codigo: form.codigo.trim() || null,
    grupo: form.grupo.trim() || null,
    unidad_default: form.unidad.trim() || null,
    tasa_iva_default: Number(form.tasaIva),
  };
}

export default function CatalogoPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscar, setBuscar] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [nuevo, setNuevo] = useState<FormularioProducto>(FORMULARIO_VACIO);
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  const [edicion, setEdicion] = useState<(FormularioProducto & { id: string }) | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorEditar, setErrorEditar] = useState<string | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    const termino = buscar.trim();
    const temporizador = setTimeout(async () => {
      setCargando(true);
      setErrorLista(null);
      try {
        const consulta = termino ? `?buscar=${encodeURIComponent(termino)}` : "";
        const res = await fetchApi(`/catalogo/productos${consulta}`, {
          signal: controlador.signal,
        });
        if (!res.ok) {
          setErrorLista(await extraerDetalle(res, "Error al cargar el catálogo"));
          return;
        }
        setProductos((await res.json()) as Producto[]);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setErrorLista(ERROR_CONEXION);
        }
      } finally {
        if (!controlador.signal.aborted) setCargando(false);
      }
    }, 300);
    return () => {
      controlador.abort();
      clearTimeout(temporizador);
    };
  }, [buscar, recarga]);

  async function manejarCrear(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreando(true);
    setErrorCrear(null);
    try {
      const res = await fetchApi("/catalogo/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoProducto(nuevo)),
      });
      if (!res.ok) {
        setErrorCrear(await extraerDetalle(res, "Error al crear el producto"));
        return;
      }
      setNuevo(FORMULARIO_VACIO);
      setRecarga((n) => n + 1);
    } catch {
      setErrorCrear(ERROR_CONEXION);
    } finally {
      setCreando(false);
    }
  }

  async function manejarGuardar() {
    if (!edicion) return;
    setGuardando(true);
    setErrorEditar(null);
    try {
      const res = await fetchApi(`/catalogo/productos/${edicion.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoProducto(edicion)),
      });
      if (!res.ok) {
        setErrorEditar(await extraerDetalle(res, "Error al guardar los cambios"));
        return;
      }
      setEdicion(null);
      setRecarga((n) => n + 1);
    } catch {
      setErrorEditar(ERROR_CONEXION);
    } finally {
      setGuardando(false);
    }
  }

  function iniciarEdicion(producto: Producto) {
    setErrorEditar(null);
    setEdicion({
      id: producto.id,
      nombre: producto.nombre_oficial,
      codigo: producto.codigo ?? "",
      grupo: producto.grupo ?? "",
      unidad: producto.unidad_default ?? "",
      tasaIva: String(producto.tasa_iva_default),
    });
  }

  const claseInput =
    "rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";
  const claseInputFila = "w-full rounded border border-gray-300 px-2 py-1 text-sm";

  return (
    <main className="p-8 max-w-4xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo de productos</h1>
          <p className="text-sm text-gray-600 mt-1">
            Espejo del Excel «Requisición Abastecimientos»: mismo nombre, código y
            grupo, con su unidad y tasa de IVA por defecto.
          </p>
        </div>
        <Link
          href="/catalogo/importar"
          className="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Importar desde Excel
        </Link>
      </div>

      <form onSubmit={manejarCrear} className="flex flex-col gap-3 rounded border border-gray-200 p-4">
        <h2 className="text-sm font-semibold">Nuevo producto</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            required
            placeholder="Nombre oficial"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            className={`${claseInput} flex-1`}
          />
          <input
            type="text"
            placeholder="Código"
            value={nuevo.codigo}
            onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
            className={`${claseInput} w-full sm:w-36`}
          />
          <input
            type="text"
            placeholder="Grupo"
            value={nuevo.grupo}
            onChange={(e) => setNuevo({ ...nuevo, grupo: e.target.value })}
            className={`${claseInput} w-full sm:w-44`}
          />
          <input
            type="text"
            placeholder="Unidad"
            value={nuevo.unidad}
            onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })}
            className={`${claseInput} w-full sm:w-32`}
          />
          <input
            type="number"
            required
            min={0}
            max={100}
            step="any"
            placeholder="IVA %"
            title="Tasa de IVA por defecto (%)"
            value={nuevo.tasaIva}
            onChange={(e) => setNuevo({ ...nuevo, tasaIva: e.target.value })}
            className={`${claseInput} w-full sm:w-28`}
          />
          <button
            type="submit"
            disabled={creando || !nuevo.nombre.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creando ? "Creando…" : "Crear"}
          </button>
        </div>
        {errorCrear && (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {errorCrear}
          </p>
        )}
      </form>

      <input
        type="search"
        placeholder="Buscar por nombre o código…"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        className={claseInput}
      />

      {errorLista && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {errorLista}
        </div>
      )}
      {errorEditar && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {errorEditar}
        </div>
      )}

      {cargando ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : productos.length === 0 && !errorLista ? (
        <p className="text-sm text-gray-500">
          {buscar.trim()
            ? "Ningún producto coincide con la búsqueda."
            : "El catálogo está vacío. Crea el primer producto arriba."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 border-b border-gray-200 w-36">Código</th>
                <th className="px-4 py-2 border-b border-gray-200">Nombre oficial</th>
                <th className="px-4 py-2 border-b border-gray-200 w-52">Grupo</th>
                <th className="px-4 py-2 border-b border-gray-200 w-28">Unidad</th>
                <th className="px-4 py-2 border-b border-gray-200 w-24">IVA (%)</th>
                <th className="px-4 py-2 border-b border-gray-200 w-44"></th>
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) =>
                edicion?.id === producto.id ? (
                  <tr key={producto.id} className="bg-blue-50">
                    <td className="px-4 py-2 border-b border-gray-100">
                      <input
                        type="text"
                        value={edicion.codigo}
                        onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })}
                        className={claseInputFila}
                      />
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      <input
                        type="text"
                        required
                        value={edicion.nombre}
                        onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                        className={claseInputFila}
                      />
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      <input
                        type="text"
                        value={edicion.grupo}
                        onChange={(e) => setEdicion({ ...edicion, grupo: e.target.value })}
                        className={claseInputFila}
                      />
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      <input
                        type="text"
                        value={edicion.unidad}
                        onChange={(e) => setEdicion({ ...edicion, unidad: e.target.value })}
                        className={claseInputFila}
                      />
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      <input
                        type="number"
                        required
                        min={0}
                        max={100}
                        step="any"
                        value={edicion.tasaIva}
                        onChange={(e) => setEdicion({ ...edicion, tasaIva: e.target.value })}
                        className={claseInputFila}
                      />
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={manejarGuardar}
                        disabled={guardando || !edicion.nombre.trim()}
                        className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {guardando ? "Guardando…" : "Guardar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEdicion(null)}
                        disabled={guardando}
                        className="ml-2 rounded border border-gray-300 px-3 py-1 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={producto.id}>
                    <td className="px-4 py-2 border-b border-gray-100 whitespace-nowrap">
                      {producto.codigo ?? "—"}
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      {producto.nombre_oficial}
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      {producto.grupo ?? "—"}
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      {producto.unidad_default ?? "—"}
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100">
                      {producto.tasa_iva_default}
                    </td>
                    <td className="px-4 py-2 border-b border-gray-100 text-right">
                      <button
                        type="button"
                        onClick={() => iniciarEdicion(producto)}
                        className="text-blue-600 hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
