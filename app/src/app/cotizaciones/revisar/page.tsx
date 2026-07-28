"use client";

// Pantalla de revisión de la cotización extraída (INSTRUCCIONS.MD §7 paso 5):
// el usuario confirma/corrige el producto oficial de cada ítem (creando el
// alias del proveedor al confirmar), agrega descuentos y completa los campos
// manuales obligatorios antes de generar la orden. Los totales mostrados son
// solo informativos: el backend los recalcula al generar la orden.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Candidato,
  CLAVE_REVISION,
  ERROR_CONEXION,
  extraerDetalle,
  fetchApi,
  formatoCOP,
  abrirDocumentoOrden,
  NivelResolucion,
  OrdenGenerada,
  OrigenResolucion,
  Producto,
  Proveedor,
  RevisionPendiente,
} from "@/lib/api";
import { limpiarPdfCotizacion, obtenerPdfCotizacion } from "@/lib/pdf-cotizacion";

interface ItemRevision {
  descripcion: string;
  referencia: string; // código del proveedor; se guarda con el alias al confirmar
  unidad: string;
  cantidad: number;
  valorUnitario: number;
  origen: OrigenResolucion;
  nivel: NivelResolucion;
  confianza: number;
  justificacion: string | null;
  candidatos: Candidato[];
  aliasOriginalId: string | null; // producto que ya estaba guardado como alias
  productoId: string; // "" = sin resolver
  descuento: string; // % por ítem, default "0"
  incluir: boolean; // si entra en la orden (se puede excluir sin borrar)
  confirmado: boolean;
  guardando: boolean;
  error: string | null;
}

interface DatosProveedor {
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
}

interface CamposOrden {
  proyecto: string;
  plazoEntrega: string;
  formaPago: string;
  sitioEntrega: string;
  tasaIva: string; // default "19"
  descuentoGeneral: string; // default "0"
}

const CREAR_NUEVO = "__nuevo__";

const ETIQUETA_ORIGEN: Record<OrigenResolucion, string> = {
  alias: "Alias",
  historico: "Histórico",
  fuzzy: "Fuzzy",
  gemini: "Gemini",
  sin_match: "Sin match",
};

// El color va por NIVEL de confianza, no por origen: lo que el usuario necesita
// saber de un vistazo es a cuáles debe prestarles atención. Verde no significa
// confirmado — confirmar sigue siendo siempre un clic suyo.
const CLASE_NIVEL: Record<NivelResolucion, string> = {
  alta: "bg-green-100 text-green-800",
  media: "bg-amber-100 text-amber-900",
  baja: "bg-red-100 text-red-800",
};

function numeroDe(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

export default function RevisarCotizacionPage() {
  const [estado, setEstado] = useState<"cargando" | "sin_datos" | "listo">("cargando");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [advertencias, setAdvertencias] = useState<string[]>([]);

  const [proveedor, setProveedor] = useState<DatosProveedor>({
    nombre: "",
    nit: "",
    direccion: "",
    ciudad: "",
  });
  const [proveedorExistente, setProveedorExistente] = useState(false);
  const [nitVerificado, setNitVerificado] = useState("");

  const [numeroCotizacion, setNumeroCotizacion] = useState("");
  const [items, setItems] = useState<ItemRevision[]>([]);
  const [catalogo, setCatalogo] = useState<Producto[]>([]);
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);

  // Creación de producto nuevo desde el selector de un ítem
  const [crearPara, setCrearPara] = useState<number | null>(null);
  const [nuevoProducto, setNuevoProducto] = useState({ nombre: "", unidad: "", tasaIva: "19" });
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  const [campos, setCampos] = useState<CamposOrden>({
    proyecto: "",
    plazoEntrega: "",
    formaPago: "",
    sitioEntrega: "",
    tasaIva: "19",
    descuentoGeneral: "0",
  });
  const [generando, setGenerando] = useState(false);
  const [ordenGenerada, setOrdenGenerada] = useState<OrdenGenerada | null>(null);
  const [errorGenerar, setErrorGenerar] = useState<string | null>(null);

  // --- Carga inicial: sessionStorage + catálogo + proveedor por NIT ---------

  useEffect(() => {
    // sessionStorage solo existe en el cliente; se difiere a una microtarea
    // para no llamar setState de forma síncrona dentro del efecto.
    let cancelado = false;
    Promise.resolve().then(() => {
      if (!cancelado) cargarRevision();
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cargarRevision() {
    const crudo = sessionStorage.getItem(CLAVE_REVISION);
    if (!crudo) {
      setEstado("sin_datos");
      return;
    }
    const revision = JSON.parse(crudo) as RevisionPendiente;
    const { cotizacion, resolucion } = revision;

    setNombreArchivo(revision.nombreArchivo);
    setAdvertencias(resolucion.advertencias);
    setProveedor({
      nombre: cotizacion.proveedor.nombre,
      nit: cotizacion.proveedor.nit,
      direccion: cotizacion.proveedor.direccion,
      ciudad: cotizacion.proveedor.ciudad,
    });
    setNumeroCotizacion(cotizacion.numero_cotizacion);
    setItems(
      cotizacion.items.map((item, i) => {
        const res = resolucion.resoluciones[i];
        const mejor = res?.candidatos[0];
        return {
          descripcion: item.descripcion,
          referencia: item.referencia ?? "",
          unidad: item.unidad,
          cantidad: item.cantidad,
          valorUnitario: item.valor_unitario,
          origen: res?.origen ?? "sin_match",
          nivel: res?.nivel ?? "baja",
          confianza: res?.confianza ?? 0,
          justificacion: mejor?.justificacion ?? null,
          candidatos: res?.candidatos ?? [],
          aliasOriginalId: res?.origen === "alias" ? (mejor?.producto_empresa_id ?? null) : null,
          productoId: mejor?.producto_empresa_id ?? "",
          descuento: "0",
          incluir: true,
          confirmado: res?.origen === "alias",
          guardando: false,
          error: null,
        };
      }),
    );
    setEstado("listo");

    fetchApi("/catalogo/productos")
      .then(async (res) => {
        if (res.ok) setCatalogo((await res.json()) as Producto[]);
        else setErrorGlobal(await extraerDetalle(res, "Error al cargar el catálogo"));
      })
      .catch(() => setErrorGlobal(ERROR_CONEXION));

    if (cotizacion.proveedor.nit.trim()) {
      verificarNit(cotizacion.proveedor.nit.trim());
    }
  }

  async function verificarNit(nit: string) {
    setNitVerificado(nit);
    try {
      const res = await fetchApi(`/proveedores/${encodeURIComponent(nit)}`);
      if (res.ok) {
        const datos = (await res.json()) as Proveedor;
        setProveedor({
          nombre: datos.nombre,
          nit: datos.nit,
          direccion: datos.direccion ?? "",
          ciudad: datos.ciudad ?? "",
        });
        setProveedorExistente(true);
      } else {
        setProveedorExistente(false);
      }
    } catch {
      setErrorGlobal(ERROR_CONEXION);
    }
  }

  // --- Ítems ------------------------------------------------------------------

  function actualizarItem(indice: number, cambios: Partial<ItemRevision>) {
    setItems((previos) => previos.map((it, i) => (i === indice ? { ...it, ...cambios } : it)));
  }

  function eliminarItem(indice: number) {
    // Eliminar reindexa la lista: se cierra el formulario de "crear producto"
    // para que no quede apuntando a otro ítem.
    setCrearPara(null);
    setItems((previos) => previos.filter((_, i) => i !== indice));
  }

  function cambiarProducto(indice: number, valor: string) {
    if (valor === CREAR_NUEVO) {
      const item = items[indice];
      setNuevoProducto({ nombre: item.descripcion, unidad: item.unidad, tasaIva: "19" });
      setErrorCrear(null);
      setCrearPara(indice);
      return;
    }
    actualizarItem(indice, { productoId: valor, confirmado: false, error: null });
  }

  async function confirmarItem(indice: number) {
    const item = items[indice];
    if (!item.productoId) return;

    const nit = proveedor.nit.trim();
    if (!nit) {
      actualizarItem(indice, {
        error: "Ingresa el NIT del proveedor antes de confirmar (el alias se guarda por NIT).",
      });
      return;
    }

    // Si el producto ya estaba guardado como alias exacto, no hay nada que aprender.
    if (item.origen === "alias" && item.productoId === item.aliasOriginalId) {
      actualizarItem(indice, { confirmado: true, error: null });
      return;
    }

    actualizarItem(indice, { guardando: true, error: null });
    try {
      const res = await fetchApi("/catalogo/alias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_nit: nit,
          nombre_proveedor_texto: item.descripcion.trim(),
          producto_empresa_id: item.productoId,
          // La referencia del proveedor es una clave más estable que el texto:
          // el proveedor reescribe la descripción, pero no su propio código.
          referencia_proveedor: item.referencia.trim(),
        }),
      });
      if (!res.ok) {
        actualizarItem(indice, {
          guardando: false,
          error: await extraerDetalle(res, "Error al guardar el alias"),
        });
        return;
      }
      actualizarItem(indice, {
        guardando: false,
        confirmado: true,
        aliasOriginalId: item.productoId,
        origen: "alias",
        nivel: "alta",
        confianza: 100,
      });
    } catch {
      actualizarItem(indice, { guardando: false, error: ERROR_CONEXION });
    }
  }

  async function crearProducto(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (crearPara === null) return;
    setCreando(true);
    setErrorCrear(null);
    try {
      const res = await fetchApi("/catalogo/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre_oficial: nuevoProducto.nombre.trim(),
          unidad_default: nuevoProducto.unidad.trim() || null,
          tasa_iva_default: numeroDe(nuevoProducto.tasaIva),
        }),
      });
      if (!res.ok) {
        setErrorCrear(await extraerDetalle(res, "Error al crear el producto"));
        return;
      }
      const producto = (await res.json()) as Producto;
      setCatalogo((previos) =>
        [...previos, producto].sort((a, b) => a.nombre_oficial.localeCompare(b.nombre_oficial)),
      );
      actualizarItem(crearPara, { productoId: producto.id, confirmado: false, error: null });
      setCrearPara(null);
    } catch {
      setErrorCrear(ERROR_CONEXION);
    } finally {
      setCreando(false);
    }
  }

  // --- Totales (informativos; el backend recalcula al generar) ----------------

  const totales = useMemo(() => {
    const subtotal = items.reduce((suma, item) => {
      if (!item.incluir) return suma;
      const descuento = Math.min(Math.max(numeroDe(item.descuento), 0), 100);
      return suma + item.cantidad * item.valorUnitario * (1 - descuento / 100);
    }, 0);
    const descuentoGeneral = Math.min(Math.max(numeroDe(campos.descuentoGeneral), 0), 100);
    const valorDescuento = subtotal * (descuentoGeneral / 100);
    const baseIva = subtotal - valorDescuento;
    const iva = baseIva * (numeroDe(campos.tasaIva) / 100);
    return { subtotal, valorDescuento, baseIva, iva, total: baseIva + iva };
  }, [items, campos.descuentoGeneral, campos.tasaIva]);

  // --- Validación del botón "Generar orden" ------------------------------------

  const pendientes = useMemo(() => {
    const faltas: string[] = [];
    if (!proveedor.nombre.trim()) faltas.push("Nombre del proveedor");
    if (!proveedor.nit.trim()) faltas.push("NIT del proveedor");
    if (!campos.proyecto.trim()) faltas.push("Proyecto");
    if (!campos.plazoEntrega.trim()) faltas.push("Plazo de entrega");
    if (!campos.formaPago.trim()) faltas.push("Forma de pago");
    if (!campos.sitioEntrega.trim()) faltas.push("Sitio de entrega");
    const tasa = Number(campos.tasaIva);
    if (campos.tasaIva.trim() === "" || !Number.isFinite(tasa) || tasa < 0 || tasa > 100) {
      faltas.push("Tasa de IVA válida (0-100)");
    }
    const incluidos = items.filter((it) => it.incluir);
    if (incluidos.length === 0) faltas.push("Selecciona al menos un ítem para la orden");
    const sinProducto = incluidos.filter((it) => !it.productoId).length;
    if (sinProducto > 0) faltas.push(`${sinProducto} ítem(s) sin producto asignado`);
    const sinConfirmar = incluidos.filter((it) => it.productoId && !it.confirmado).length;
    if (sinConfirmar > 0) faltas.push(`${sinConfirmar} ítem(s) sin confirmar`);
    return faltas;
  }, [proveedor, campos, items]);

  async function generarOrden() {
    const borrador = {
      proveedor,
      proveedor_existente: proveedorExistente,
      numero_cotizacion: numeroCotizacion.trim(),
      proyecto: campos.proyecto.trim(),
      plazo_entrega: campos.plazoEntrega.trim(),
      forma_pago: campos.formaPago.trim(),
      sitio_entrega: campos.sitioEntrega.trim(),
      tasa_iva: numeroDe(campos.tasaIva),
      descuento_general_porcentaje: numeroDe(campos.descuentoGeneral),
      // Solo los ítems incluidos entran a la orden; se renumeran de forma
      // consecutiva para que item_num no tenga huecos.
      items: items
        .filter((item) => item.incluir)
        .map((item, i) => ({
          item_num: i + 1,
          producto_empresa_id: item.productoId,
          descripcion_proveedor: item.descripcion,
          unidad: item.unidad,
          cantidad: item.cantidad,
          valor_unitario: item.valorUnitario,
          descuento_porcentaje: numeroDe(item.descuento),
        })),
    };

    setGenerando(true);
    setErrorGenerar(null);
    try {
      const formData = new FormData();
      formData.append("borrador", JSON.stringify(borrador));
      const pdf = obtenerPdfCotizacion();
      if (pdf) formData.append("pdf_cotizacion", pdf);

      const res = await fetchApi("/ordenes/generar", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        setErrorGenerar(await extraerDetalle(res, "Error al generar la orden"));
        return;
      }
      const orden = (await res.json()) as OrdenGenerada;
      setOrdenGenerada(orden);
      // La revisión terminó: se limpia el traspaso para no regenerar por accidente.
      sessionStorage.removeItem(CLAVE_REVISION);
      limpiarPdfCotizacion();
    } catch {
      setErrorGenerar(ERROR_CONEXION);
    } finally {
      setGenerando(false);
    }
  }

  async function descargarDocumento() {
    if (!ordenGenerada) return;
    const error = await abrirDocumentoOrden(ordenGenerada.id);
    if (error) setErrorGenerar(error);
  }

  const itemsIncluidos = items.filter((it) => it.incluir).length;

  // --- Render -------------------------------------------------------------------

  if (estado === "cargando") {
    return <main className="p-8 text-sm text-gray-500">Cargando…</main>;
  }
  if (estado === "sin_datos") {
    return (
      <main className="p-8 max-w-3xl mx-auto flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Revisión de cotización</h1>
        <p className="text-sm text-gray-600">
          No hay ninguna cotización en revisión. Sube primero el PDF de la cotización.
        </p>
        <Link href="/cotizaciones" className="text-blue-600 hover:underline text-sm">
          ← Subir cotización
        </Link>
      </main>
    );
  }

  const claseInput =
    "rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100 read-only:bg-gray-100";
  const claseCelda = "px-3 py-2 border-b border-gray-100 align-top";

  return (
    <main className="p-8 max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <Link href="/cotizaciones" className="text-sm text-blue-600 hover:underline">
          ← Cotizaciones
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Revisión de cotización</h1>
        <p className="text-sm text-gray-600 mt-1">
          Extraída de <span className="font-medium">{nombreArchivo}</span>. Confirma cada
          ítem, completa los campos de la orden y genera el documento.
        </p>
      </div>

      {advertencias.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <ul className="list-disc pl-5 text-sm text-amber-800">
            {advertencias.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {errorGlobal && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {errorGlobal}
        </div>
      )}

      {/* Proveedor y cotización */}
      <section className="rounded border border-gray-200 p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Proveedor</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              proveedorExistente ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {proveedorExistente ? "Registrado" : "Nuevo — se creará al generar la orden"}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            NIT *
            <input
              type="text"
              value={proveedor.nit}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, nit: e.target.value })}
              onBlur={() => {
                const nit = proveedor.nit.trim();
                if (nit && nit !== nitVerificado) verificarNit(nit);
              }}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Nombre *
            <input
              type="text"
              value={proveedor.nombre}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, nombre: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Dirección
            <input
              type="text"
              value={proveedor.direccion}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, direccion: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Ciudad
            <input
              type="text"
              value={proveedor.ciudad}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, ciudad: e.target.value })}
              className={claseInput}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-600 max-w-xs">
          Número de cotización
          <input
            type="text"
            value={numeroCotizacion}
            onChange={(e) => setNumeroCotizacion(e.target.value)}
            className={claseInput}
          />
        </label>
      </section>

      {/* Ítems */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">Ítems</h2>
          <span className="text-xs text-gray-500">
            {itemsIncluidos === items.length
              ? `${items.length}`
              : `${itemsIncluidos} de ${items.length} seleccionados`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className={`${claseCelda} border-b-gray-200 w-12 text-center`}>Incl.</th>
                <th className={`${claseCelda} border-b-gray-200`}>Descripción del proveedor</th>
                <th className={`${claseCelda} border-b-gray-200 min-w-64`}>Producto oficial</th>
                <th className={`${claseCelda} border-b-gray-200 w-24`}>Desc. %</th>
                <th className={`${claseCelda} border-b-gray-200 w-32 text-right`}>Total ítem</th>
                <th className={`${claseCelda} border-b-gray-200 w-40`}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const etiqueta = ETIQUETA_ORIGEN[item.origen];
                const descuento = Math.min(Math.max(numeroDe(item.descuento), 0), 100);
                const totalItem = item.cantidad * item.valorUnitario * (1 - descuento / 100);
                return (
                  <tr
                    key={i}
                    className={
                      !item.incluir
                        ? "bg-gray-50 text-gray-400"
                        : item.confirmado
                          ? "bg-green-50/50"
                          : ""
                    }
                  >
                    <td className={`${claseCelda} text-center`}>
                      <input
                        type="checkbox"
                        checked={item.incluir}
                        onChange={(e) => actualizarItem(i, { incluir: e.target.checked })}
                        title="Incluir este ítem en la orden"
                        className="h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className={claseCelda}>
                      <p>{item.descripcion}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {item.cantidad} {item.unidad || "und"} × {formatoCOP(item.valorUnitario)}
                      </p>
                    </td>
                    <td className={claseCelda}>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <select
                            value={item.productoId}
                            onChange={(e) => cambiarProducto(i, e.target.value)}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          >
                            <option value="">— Sin resolver —</option>
                            {catalogo.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nombre_oficial}
                                {p.codigo ? ` — ${p.codigo}` : ""}
                              </option>
                            ))}
                            <option value={CREAR_NUEVO}>+ Crear producto nuevo…</option>
                          </select>
                          <span
                            title={item.justificacion ?? undefined}
                            className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${CLASE_NIVEL[item.nivel]}`}
                          >
                            {etiqueta}
                            {item.origen !== "alias" && item.origen !== "sin_match"
                              ? ` ${Math.round(item.confianza)}%`
                              : ""}
                          </span>
                        </div>
                        {item.candidatos.length > 1 && !item.confirmado && (
                          <p className="text-xs text-gray-500">
                            Alternativas:{" "}
                            {item.candidatos.slice(1).map((c, j) => (
                              <button
                                key={c.producto_empresa_id}
                                type="button"
                                onClick={() => cambiarProducto(i, c.producto_empresa_id)}
                                className="text-blue-600 hover:underline"
                              >
                                {j > 0 ? " · " : ""}
                                {c.nombre_oficial}
                                {c.codigo ? ` [${c.codigo}]` : ""} ({Math.round(c.score)}%)
                              </button>
                            ))}
                          </p>
                        )}
                        {item.error && <p className="text-xs text-red-700">{item.error}</p>}
                      </div>
                    </td>
                    <td className={claseCelda}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        value={item.descuento}
                        onChange={(e) => actualizarItem(i, { descuento: e.target.value })}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className={`${claseCelda} text-right whitespace-nowrap`}>
                      {formatoCOP(totalItem)}
                    </td>
                    <td className={claseCelda}>
                      <div className="flex flex-col items-start gap-1">
                        {item.confirmado ? (
                          <span className="text-sm font-medium text-green-700">
                            ✓ Confirmado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => confirmarItem(i)}
                            disabled={!item.productoId || item.guardando}
                            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {item.guardando ? "Guardando…" : "Confirmar"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => eliminarItem(i)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {crearPara !== null && (
          <form
            onSubmit={crearProducto}
            className="rounded border border-blue-200 bg-blue-50 p-4 flex flex-col gap-3"
          >
            <h3 className="text-sm font-semibold">
              Crear producto nuevo para: “{items[crearPara]?.descripcion}”
            </h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                required
                placeholder="Nombre oficial"
                value={nuevoProducto.nombre}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
                className={`${claseInput} flex-1 bg-white`}
              />
              <input
                type="text"
                placeholder="Unidad"
                value={nuevoProducto.unidad}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, unidad: e.target.value })}
                className={`${claseInput} w-full sm:w-32 bg-white`}
              />
              <input
                type="number"
                required
                min={0}
                max={100}
                step="any"
                title="Tasa de IVA por defecto (%)"
                value={nuevoProducto.tasaIva}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, tasaIva: e.target.value })}
                className={`${claseInput} w-full sm:w-24 bg-white`}
              />
              <button
                type="submit"
                disabled={creando || !nuevoProducto.nombre.trim()}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creando ? "Creando…" : "Crear y asignar"}
              </button>
              <button
                type="button"
                onClick={() => setCrearPara(null)}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
              >
                Cancelar
              </button>
            </div>
            {errorCrear && <p className="text-sm text-red-700">{errorCrear}</p>}
          </form>
        )}
      </section>

      {/* Campos manuales de la orden */}
      <section className="rounded border border-gray-200 p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Datos de la orden (obligatorios)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Proyecto *
            <input
              type="text"
              value={campos.proyecto}
              onChange={(e) => setCampos({ ...campos, proyecto: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Plazo de entrega *
            <input
              type="text"
              value={campos.plazoEntrega}
              onChange={(e) => setCampos({ ...campos, plazoEntrega: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Forma de pago *
            <input
              type="text"
              value={campos.formaPago}
              onChange={(e) => setCampos({ ...campos, formaPago: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Sitio de entrega *
            <input
              type="text"
              value={campos.sitioEntrega}
              onChange={(e) => setCampos({ ...campos, sitioEntrega: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Tasa de IVA (%) *
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={campos.tasaIva}
              onChange={(e) => setCampos({ ...campos, tasaIva: e.target.value })}
              className={claseInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            Descuento general (%)
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={campos.descuentoGeneral}
              onChange={(e) => setCampos({ ...campos, descuentoGeneral: e.target.value })}
              className={claseInput}
            />
          </label>
        </div>
      </section>

      {/* Totales informativos */}
      <section className="rounded border border-gray-200 p-4 sm:max-w-sm sm:ml-auto w-full">
        <dl className="text-sm flex flex-col gap-1">
          <div className="flex justify-between">
            <dt className="text-gray-600">Subtotal (con desc. por ítem)</dt>
            <dd>{formatoCOP(totales.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Descuento general</dt>
            <dd>− {formatoCOP(totales.valorDescuento)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Base IVA</dt>
            <dd>{formatoCOP(totales.baseIva)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">IVA ({campos.tasaIva || 0}%)</dt>
            <dd>{formatoCOP(totales.iva)}</dd>
          </div>
          <div className="flex justify-between font-semibold border-t border-gray-200 mt-1 pt-1">
            <dt>Total</dt>
            <dd>{formatoCOP(totales.total)}</dd>
          </div>
        </dl>
        <p className="text-xs text-gray-500 mt-2">
          Valores informativos: el sistema los recalcula al generar la orden.
        </p>
      </section>

      {/* Generar */}
      <section className="flex flex-col gap-3 items-end">
        {pendientes.length > 0 && (
          <ul className="text-xs text-gray-500 list-disc pl-5 self-end text-right list-inside">
            {pendientes.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {!ordenGenerada && (
          <button
            type="button"
            onClick={generarOrden}
            disabled={pendientes.length > 0 || generando}
            className="rounded bg-green-700 px-6 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generando ? "Generando orden…" : "Generar orden"}
          </button>
        )}
        {errorGenerar && (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {errorGenerar}
          </p>
        )}
        {ordenGenerada && (
          <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-800 flex flex-col gap-2 items-end">
            <p>
              Orden <span className="font-semibold">{ordenGenerada.numero_orden}</span>{" "}
              generada por {formatoCOP(ordenGenerada.totales.total)}.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={descargarDocumento}
                className="rounded bg-green-700 px-4 py-2 text-xs font-semibold text-white hover:bg-green-800"
              >
                Descargar documento
              </button>
              <Link
                href="/ordenes"
                className="rounded border border-green-700 px-4 py-2 text-xs font-semibold text-green-800 hover:bg-green-100"
              >
                Ver historial
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
