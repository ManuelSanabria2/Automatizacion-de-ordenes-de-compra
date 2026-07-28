"use client";

// Catálogo de productos oficiales de la empresa: listar, buscar por nombre o
// código, crear y editar. Es espejo del Excel "Requisición Abastecimientos"
// (mismo nombre, código y grupo). Los alias por proveedor se gestionan aparte.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ERROR_CONEXION, extraerDetalle, fetchApi, type Producto } from "@/lib/api";
import { Campo } from "@/components/Campo";
import { Aviso, Boton, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";
import { Cabecera, Fila, Tabla, Td, Th, Vacio } from "@/components/Tabla";

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

  const claseFila =
    "w-full rounded-suave border border-acero-claro bg-papel px-2 py-1 text-dato focus:border-tinta";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Titulo>Catálogo de productos</Titulo>
          <p className="mt-2 max-w-2xl text-cuerpo text-acero">
            Espejo del Excel «Requisición Abastecimientos»: mismo nombre, código y grupo, con
            su unidad y tasa de IVA por defecto.
          </p>
        </div>
        <Link
          href="/catalogo/importar"
          className="shrink-0 rounded-suave border border-tinta bg-tinta px-4 py-2 text-cuerpo font-medium text-papel hover:bg-tinta/90"
        >
          Importar desde Excel
        </Link>
      </div>

      <Tarjeta className="p-6">
        <form onSubmit={manejarCrear} className="flex flex-col gap-4">
          <Etiqueta>Nuevo producto</Etiqueta>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Campo
              etiqueta="Nombre oficial"
              required
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            />
          </div>
          <Campo
            etiqueta="Código"
            value={nuevo.codigo}
            onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}
          />
          <Campo
            etiqueta="Grupo"
            value={nuevo.grupo}
            onChange={(e) => setNuevo({ ...nuevo, grupo: e.target.value })}
          />
          <Campo
            etiqueta="Unidad"
            value={nuevo.unidad}
            onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })}
          />
          <Campo
            etiqueta="IVA %"
            type="number"
            required
            min={0}
            max={100}
            step="any"
            ayuda="Tasa de IVA por defecto (%)"
            value={nuevo.tasaIva}
            onChange={(e) => setNuevo({ ...nuevo, tasaIva: e.target.value })}
          />
        </div>
          {errorCrear && <Aviso tono="error">{errorCrear}</Aviso>}
          <div>
            <Boton type="submit" variante="principal" disabled={creando || !nuevo.nombre.trim()}>
              {creando ? "Creando…" : "Crear"}
            </Boton>
          </div>
        </form>
      </Tarjeta>

      <div className="max-w-md">
        <Campo
          etiqueta="Buscar por nombre o código"
          type="search"
          placeholder="Buscar por nombre o código…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      </div>

      {errorLista && <Aviso tono="error">{errorLista}</Aviso>}
      {errorEditar && <Aviso tono="error">{errorEditar}</Aviso>}

      {cargando ? (
        <p className="text-cuerpo text-acero">Cargando…</p>
      ) : productos.length === 0 && !errorLista ? (
        <Tarjeta className="p-6">
          <p className="text-cuerpo text-acero">
            {buscar.trim()
              ? "Ningún producto coincide con la búsqueda."
              : "El catálogo está vacío. Crea el primer producto arriba."}
          </p>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <div className="border-b border-acero-claro px-4 py-3">
            <Etiqueta>
              {buscar.trim()
                ? `${productos.length} coinciden con «${buscar.trim()}»`
                : `${productos.length} productos en el catálogo`}
            </Etiqueta>
          </div>
          <Tabla descripcion="Productos del catálogo oficial de la empresa" ancho="60rem">
          <Cabecera>
            <Th className="w-36">Código</Th>
            <Th>Nombre oficial</Th>
            <Th className="w-52">Grupo</Th>
            <Th className="w-28">Unidad</Th>
            <Th className="w-24" numerica>
              IVA (%)
            </Th>
            <Th className="w-44" />
          </Cabecera>
          <tbody>
            {productos.map((producto) =>
              edicion?.id === producto.id ? (
                <Fila key={producto.id} className="bg-campo">
                  <Td>
                    <input
                      type="text"
                      value={edicion.codigo}
                      onChange={(e) => setEdicion({ ...edicion, codigo: e.target.value })}
                      aria-label="Código"
                      className={claseFila}
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      required
                      value={edicion.nombre}
                      onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                      aria-label="Nombre oficial"
                      className={claseFila}
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      value={edicion.grupo}
                      onChange={(e) => setEdicion({ ...edicion, grupo: e.target.value })}
                      aria-label="Grupo"
                      className={claseFila}
                    />
                  </Td>
                  <Td>
                    <input
                      type="text"
                      value={edicion.unidad}
                      onChange={(e) => setEdicion({ ...edicion, unidad: e.target.value })}
                      aria-label="Unidad"
                      className={claseFila}
                    />
                  </Td>
                  <Td>
                    <input
                      type="number"
                      required
                      min={0}
                      max={100}
                      step="any"
                      value={edicion.tasaIva}
                      onChange={(e) => setEdicion({ ...edicion, tasaIva: e.target.value })}
                      aria-label="IVA por defecto en porcentaje"
                      className={`${claseFila} text-right`}
                    />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Boton
                      variante="principal"
                      onClick={manejarGuardar}
                      disabled={guardando || !edicion.nombre.trim()}
                    >
                      {guardando ? "Guardando…" : "Guardar"}
                    </Boton>
                    <Boton
                      className="ml-2"
                      onClick={() => setEdicion(null)}
                      disabled={guardando}
                    >
                      Cancelar
                    </Boton>
                  </Td>
                </Fila>
              ) : (
                <Fila key={producto.id}>
                  <Td className="font-mono whitespace-nowrap">
                    {producto.codigo ?? <Vacio />}
                  </Td>
                  <Td>{producto.nombre_oficial}</Td>
                  <Td className="text-acero">{producto.grupo ?? <Vacio />}</Td>
                  <Td className="text-acero">{producto.unidad_default ?? <Vacio />}</Td>
                  <Td numerica className="font-mono">
                    {producto.tasa_iva_default}
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => iniciarEdicion(producto)}
                      className="text-cuerpo underline underline-offset-4"
                    >
                      Editar
                    </button>
                  </Td>
                </Fila>
              ),
            )}
          </tbody>
          </Tabla>
        </Tarjeta>
      )}
    </div>
  );
}
