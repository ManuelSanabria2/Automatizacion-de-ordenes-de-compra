"use client";

// Pantalla de revisión de la cotización extraída (INSTRUCCIONS.MD §7 paso 5):
// el usuario confirma/corrige el producto oficial de cada ítem (creando el
// alias del proveedor al confirmar), agrega descuentos y completa los campos
// manuales obligatorios antes de generar la orden. Los totales mostrados son
// solo informativos: el backend los recalcula al generar la orden.
//
// El trabajo no es uniforme: de 55 ítems, la mayoría vienen de un alias ya
// confirmado y solo unos pocos son decisiones reales. Por eso la pantalla tiene
// tres momentos —resumen, revisión de los dudosos uno a uno, y cierre— con la
// tabla completa siempre a un clic para quien prefiera verlo todo junto.

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
  TotalesExtraidos,
} from "@/lib/api";
import { limpiarPdfCotizacion, obtenerPdfCotizacion } from "@/lib/pdf-cotizacion";
import { Aviso, Boton, Etiqueta, Tarjeta, Titulo } from "@/components/Tarjeta";
import { Campo, claseCampo } from "@/components/Campo";
import { BuscadorProducto } from "@/components/BuscadorProducto";
import { ResumenCotizacion, type Conteos } from "@/components/ResumenCotizacion";
import { TarjetaDecision } from "@/components/TarjetaDecision";
import { Cabecera, Fila, Tabla, Td, Th } from "@/components/Tabla";

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

/** De dónde salió la propuesta, dicho para alguien que no conoce el sistema. */
const PROCEDENCIA: Record<OrigenResolucion, string> = {
  alias: "Ya lo confirmaste antes para este proveedor",
  historico: "Confirmado antes en otra cotización",
  fuzzy: "Encontrado por parecido de nombre",
  gemini: "Sugerido por el asistente",
  sin_match: "No se encontró nada parecido",
};

type Vista = "resumen" | "revision" | "tabla";

function numeroDe(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

export default function RevisarCotizacionPage() {
  const [estado, setEstado] = useState<"cargando" | "sin_datos" | "listo">("cargando");
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  const [totalesPdf, setTotalesPdf] = useState<TotalesExtraidos>({
    subtotal: 0,
    iva: 0,
    total: 0,
  });

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

  const [vista, setVista] = useState<Vista>("resumen");
  const [posicionRevision, setPosicionRevision] = useState(0);
  const [buscandoPara, setBuscandoPara] = useState<number | null>(null);

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
    setTotalesPdf(cotizacion.totales_pdf ?? { subtotal: 0, iva: 0, total: 0 });
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
    setBuscandoPara(null);
    setItems((previos) => previos.filter((_, i) => i !== indice));
  }

  function abrirCreacion(indice: number) {
    const item = items[indice];
    setNuevoProducto({ nombre: item.descripcion, unidad: item.unidad, tasaIva: "19" });
    setErrorCrear(null);
    setCrearPara(indice);
  }

  function cambiarProducto(indice: number, valor: string) {
    actualizarItem(indice, { productoId: valor, confirmado: false, error: null });
  }

  async function confirmarItem(indice: number): Promise<boolean> {
    const item = items[indice];
    if (!item.productoId) return false;

    const nit = proveedor.nit.trim();
    if (!nit) {
      actualizarItem(indice, {
        error: "Ingresa el NIT del proveedor antes de confirmar (el alias se guarda por NIT).",
      });
      return false;
    }

    // Si el producto ya estaba guardado como alias exacto, no hay nada que aprender.
    if (item.origen === "alias" && item.productoId === item.aliasOriginalId) {
      actualizarItem(indice, { confirmado: true, error: null });
      return true;
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
        return false;
      }
      actualizarItem(indice, {
        guardando: false,
        confirmado: true,
        aliasOriginalId: item.productoId,
        origen: "alias",
        nivel: "alta",
        confianza: 100,
      });
      return true;
    } catch {
      actualizarItem(indice, { guardando: false, error: ERROR_CONEXION });
      return false;
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

  // --- Reparto del trabajo -----------------------------------------------------

  const productoDe = (id: string) => catalogo.find((p) => p.id === id) ?? null;

  /** Índices que aún necesitan una decisión del operador. */
  const porDecidir = useMemo(
    () => items.map((item, i) => ({ item, i })).filter(({ item }) => !item.confirmado),
    [items],
  );

  const conteos: Conteos = useMemo(
    () => ({
      total: items.length,
      yaConocidos: items.filter((it) => it.confirmado).length,
      porRevisar: items.filter((it) => !it.confirmado && it.productoId).length,
      sinEncontrar: items.filter((it) => !it.confirmado && !it.productoId).length,
    }),
    [items],
  );

  const sumaItems = useMemo(
    () => items.reduce((suma, it) => suma + it.cantidad * it.valorUnitario, 0),
    [items],
  );

  function avanzar() {
    setPosicionRevision((p) => {
      const siguiente = p + 1;
      if (siguiente >= porDecidir.length) setVista("tabla");
      return siguiente;
    });
  }

  // --- Render -------------------------------------------------------------------

  if (estado === "cargando") {
    return <p className="py-10 text-cuerpo text-acero">Cargando…</p>;
  }
  if (estado === "sin_datos") {
    return (
      <div className="flex max-w-xl flex-col gap-4 py-6">
        <Titulo>Revisión de cotización</Titulo>
        <p className="text-cuerpo text-acero">
          No hay ninguna cotización en revisión. Sube primero el PDF de la cotización.
        </p>
        <Link href="/cotizaciones" className="text-cuerpo underline underline-offset-4">
          ← Subir cotización
        </Link>
      </div>
    );
  }

  const enRevision = porDecidir[posicionRevision];

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado: qué cotización es y de quién */}
      <div>
        <Titulo>Revisión de cotización</Titulo>
        <p className="mt-1 text-cuerpo text-acero">
          {numeroCotizacion && (
            <span className="font-mono text-tinta">{numeroCotizacion}</span>
          )}
          {numeroCotizacion && " · "}
          {proveedor.nombre || "Proveedor sin nombre"}
          {proveedor.nit && (
            <>
              {" · NIT "}
              <span className="font-mono">{proveedor.nit}</span>
            </>
          )}
          {" · "}
          {proveedorExistente ? "Registrado" : "Nuevo — se creará al generar la orden"}
        </p>
        <p className="mt-1 text-etiqueta text-acero">Extraída de {nombreArchivo}</p>
      </div>

      {advertencias.length > 0 && (
        <Aviso tono="atencion" titulo="Avisos de la extracción">
          <ul className="mt-1 list-disc pl-5">
            {advertencias.map((advertencia, i) => (
              <li key={i}>{advertencia}</li>
            ))}
          </ul>
        </Aviso>
      )}
      {errorGlobal && <Aviso tono="error">{errorGlobal}</Aviso>}

      {/* Navegación entre los tres momentos */}
      {vista !== "resumen" && (
        <div className="flex flex-wrap gap-3">
          <Boton variante="discreta" onClick={() => setVista("resumen")}>
            ← Resumen
          </Boton>
          {vista !== "tabla" && (
            <Boton variante="discreta" onClick={() => setVista("tabla")}>
              Ver todos los ítems
            </Boton>
          )}
          {vista !== "revision" && porDecidir.length > 0 && (
            <Boton
              variante="discreta"
              onClick={() => {
                setPosicionRevision(0);
                setVista("revision");
              }}
            >
              Revisar los {porDecidir.length} pendientes
            </Boton>
          )}
        </div>
      )}

      {vista === "resumen" && (
        <ResumenCotizacion
          conteos={conteos}
          sumaItems={sumaItems}
          totalesPdf={totalesPdf}
          alRevisar={() => {
            setPosicionRevision(0);
            setVista("revision");
          }}
          alVerTodos={() => setVista("tabla")}
        />
      )}

      {vista === "revision" &&
        (enRevision ? (
          <Tarjeta destacada className="p-6">
            <TarjetaDecision
              posicion={posicionRevision + 1}
              total={porDecidir.length}
              descripcion={enRevision.item.descripcion}
              referencia={enRevision.item.referencia}
              unidad={enRevision.item.unidad}
              cantidad={enRevision.item.cantidad}
              valorUnitario={enRevision.item.valorUnitario}
              producto={productoDe(enRevision.item.productoId)}
              procedencia={PROCEDENCIA[enRevision.item.origen]}
              justificacion={enRevision.item.justificacion}
              guardando={enRevision.item.guardando}
              error={enRevision.item.error}
              alConfirmar={async () => {
                if (await confirmarItem(enRevision.i)) avanzar();
              }}
              alBuscarOtro={() => setBuscandoPara(enRevision.i)}
              alOmitir={avanzar}
            />
          </Tarjeta>
        ) : (
          <Tarjeta className="p-6">
            <Etiqueta>Revisión terminada</Etiqueta>
            <p className="mt-2 text-item">No queda ningún ítem por decidir.</p>
            <div className="mt-4">
              <Boton variante="principal" grande onClick={() => setVista("tabla")}>
                Ver todos los ítems
              </Boton>
            </div>
          </Tarjeta>
        ))}

      {vista === "tabla" && (
        <Tarjeta>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-acero-claro px-4 py-3">
            <Etiqueta>
              {items.filter((it) => it.incluir).length} de {items.length} ítems seleccionados
            </Etiqueta>
          </div>
          <Tabla
            descripcion="Ítems de la cotización con el producto del catálogo que les corresponde"
            ancho="62rem"
          >
            <Cabecera>
              <Th className="w-14">Incluir</Th>
              <Th>Descripción del proveedor</Th>
              <Th>Producto oficial</Th>
              <Th className="w-32">Estado</Th>
              <Th className="w-24" numerica>
                Desc. %
              </Th>
              <Th className="w-36" numerica>
                Total ítem
              </Th>
              <Th className="w-28" />
            </Cabecera>
            <tbody>
              {items.map((item, i) => {
                const descuento = Math.min(Math.max(numeroDe(item.descuento), 0), 100);
                const totalItem = item.cantidad * item.valorUnitario * (1 - descuento / 100);
                const producto = productoDe(item.productoId);

                return (
                  <Fila key={i} atenuada={!item.incluir}>
                    <Td className="text-center">
                      <input
                        type="checkbox"
                        checked={item.incluir}
                        onChange={(e) => actualizarItem(i, { incluir: e.target.checked })}
                        aria-label={`Incluir «${item.descripcion}» en la orden`}
                        className="h-4 w-4 cursor-pointer accent-tinta"
                      />
                    </Td>

                    <Td>
                      <p>{item.descripcion}</p>
                      <p className="mt-0.5 font-mono text-etiqueta text-acero">
                        {item.cantidad} {item.unidad || "und"} ×{" "}
                        {formatoCOP(item.valorUnitario)}
                      </p>
                    </Td>

                    <Td>
                      <button
                        type="button"
                        onClick={() => setBuscandoPara(i)}
                        className="w-full rounded-suave border border-acero-claro px-3 py-2 text-left hover:border-acero"
                      >
                        {producto ? (
                          <>
                            <span className="block">{producto.nombre_oficial}</span>
                            <span className="mt-0.5 block font-mono text-etiqueta text-acero">
                              {producto.codigo ?? "sin código"}
                            </span>
                          </>
                        ) : (
                          <span className="text-acero">Buscar producto…</span>
                        )}
                      </button>
                      {item.error && (
                        <p role="alert" className="mt-1 text-etiqueta text-alto">
                          {item.error}
                        </p>
                      )}
                    </Td>

                    <Td>
                      {item.confirmado ? (
                        <span className="text-listo">
                          <span aria-hidden>✓ </span>Confirmado
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => confirmarItem(i)}
                          disabled={!item.productoId || item.guardando}
                          className="rounded-suave border border-atencion bg-atencion-fondo px-2 py-1 text-etiqueta font-medium text-tinta disabled:border-acero-claro disabled:bg-campo disabled:text-acero"
                        >
                          {item.guardando ? "Guardando…" : "Confirmar"}
                        </button>
                      )}
                    </Td>

                    <Td numerica>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        value={item.descuento}
                        onChange={(e) => actualizarItem(i, { descuento: e.target.value })}
                        aria-label={`Descuento en porcentaje para «${item.descripcion}»`}
                        className={`${claseCampo} py-1 text-right font-mono text-dato`}
                      />
                    </Td>

                    <Td numerica className="font-mono">
                      {formatoCOP(totalItem)}
                    </Td>

                    <Td>
                      <Boton variante="peligro" onClick={() => eliminarItem(i)}>
                        Eliminar
                      </Boton>
                    </Td>
                  </Fila>
                );
              })}
            </tbody>
          </Tabla>
        </Tarjeta>
      )}

      {/* Alta de un producto que no está en el catálogo */}
      {crearPara !== null && (
        <Tarjeta destacada className="p-6">
          <form onSubmit={crearProducto} className="flex flex-col gap-4">
            <div>
              <Etiqueta>Crear producto nuevo</Etiqueta>
              <p className="mt-1 text-cuerpo">
                Para: “{items[crearPara]?.descripcion}”
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo
                etiqueta="Nombre oficial"
                required
                value={nuevoProducto.nombre}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, nombre: e.target.value })}
              />
              <Campo
                etiqueta="Unidad"
                value={nuevoProducto.unidad}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, unidad: e.target.value })}
              />
              <Campo
                etiqueta="IVA %"
                type="number"
                min={0}
                max={100}
                step="any"
                required
                ayuda="Tasa de IVA por defecto (%)"
                value={nuevoProducto.tasaIva}
                onChange={(e) => setNuevoProducto({ ...nuevoProducto, tasaIva: e.target.value })}
              />
            </div>
            {errorCrear && <Aviso tono="error">{errorCrear}</Aviso>}
            <div className="flex gap-3">
              <Boton
                type="submit"
                variante="principal"
                disabled={creando || !nuevoProducto.nombre.trim()}
              >
                {creando ? "Creando…" : "Crear y asignar"}
              </Boton>
              <Boton type="button" variante="discreta" onClick={() => setCrearPara(null)}>
                Cancelar
              </Boton>
            </div>
          </form>
        </Tarjeta>
      )}

      {/* Datos del proveedor */}
      <Tarjeta className="p-6">
        <details open={!proveedorExistente}>
          <summary className="cursor-pointer text-etiqueta font-semibold tracking-[0.06em] text-acero uppercase">
            Datos del proveedor
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Campo
              etiqueta="NIT"
              required
              mono
              value={proveedor.nit}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, nit: e.target.value })}
              onBlur={() => {
                const nit = proveedor.nit.trim();
                if (nit && nit !== nitVerificado) verificarNit(nit);
              }}
            />
            <Campo
              etiqueta="Nombre"
              required
              value={proveedor.nombre}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, nombre: e.target.value })}
            />
            <Campo
              etiqueta="Dirección"
              value={proveedor.direccion}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, direccion: e.target.value })}
            />
            <Campo
              etiqueta="Ciudad"
              value={proveedor.ciudad}
              readOnly={proveedorExistente}
              onChange={(e) => setProveedor({ ...proveedor, ciudad: e.target.value })}
            />
            <Campo
              etiqueta="Número de cotización"
              mono
              value={numeroCotizacion}
              onChange={(e) => setNumeroCotizacion(e.target.value)}
            />
          </div>
        </details>
      </Tarjeta>

      {/* Datos manuales de la orden */}
      <Tarjeta className="p-6">
        <Etiqueta>Datos de la orden (obligatorios)</Etiqueta>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo
            etiqueta="Proyecto"
            required
            value={campos.proyecto}
            onChange={(e) => setCampos({ ...campos, proyecto: e.target.value })}
          />
          <Campo
            etiqueta="Plazo de entrega"
            required
            value={campos.plazoEntrega}
            onChange={(e) => setCampos({ ...campos, plazoEntrega: e.target.value })}
          />
          <Campo
            etiqueta="Forma de pago"
            required
            value={campos.formaPago}
            onChange={(e) => setCampos({ ...campos, formaPago: e.target.value })}
          />
          <Campo
            etiqueta="Sitio de entrega"
            required
            value={campos.sitioEntrega}
            onChange={(e) => setCampos({ ...campos, sitioEntrega: e.target.value })}
          />
          <Campo
            etiqueta="Tasa de IVA (%)"
            type="number"
            min={0}
            max={100}
            step="any"
            required
            mono
            value={campos.tasaIva}
            onChange={(e) => setCampos({ ...campos, tasaIva: e.target.value })}
          />
          <Campo
            etiqueta="Descuento general (%)"
            type="number"
            min={0}
            max={100}
            step="any"
            mono
            value={campos.descuentoGeneral}
            onChange={(e) => setCampos({ ...campos, descuentoGeneral: e.target.value })}
          />
        </div>
      </Tarjeta>

      {/* Totales y generación */}
      <Tarjeta className="p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <Etiqueta>Totales</Etiqueta>
            <dl className="mt-3 flex flex-col gap-1.5 text-cuerpo">
              <div className="flex justify-between gap-6">
                <dt className="text-acero">Subtotal (con desc. por ítem)</dt>
                <dd className="font-mono">{formatoCOP(totales.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-acero">Descuento general</dt>
                <dd className="font-mono">− {formatoCOP(totales.valorDescuento)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-acero">Base IVA</dt>
                <dd className="font-mono">{formatoCOP(totales.baseIva)}</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-acero">IVA ({campos.tasaIva || 0}%)</dt>
                <dd className="font-mono">{formatoCOP(totales.iva)}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-6 border-t border-acero-claro pt-2 text-item font-semibold">
                <dt>Total</dt>
                <dd className="font-mono">{formatoCOP(totales.total)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-etiqueta text-acero">
              Valores informativos: el sistema los recalcula al generar la orden.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {pendientes.length > 0 && (
              <div>
                <Etiqueta>Falta para poder generar</Etiqueta>
                <ul className="mt-2 list-disc pl-5 text-cuerpo text-alto">
                  {pendientes.map((falta) => (
                    <li key={falta}>{falta}</li>
                  ))}
                </ul>
              </div>
            )}

            {errorGenerar && <Aviso tono="error">{errorGenerar}</Aviso>}

            {ordenGenerada ? (
              <Aviso tono="listo" titulo={`Orden ${ordenGenerada.numero_orden} generada`}>
                <p className="mt-1">
                  Por {formatoCOP(ordenGenerada.totales.total)}.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Boton variante="principal" onClick={descargarDocumento}>
                    Descargar documento
                  </Boton>
                  <Link
                    href="/ordenes"
                    className="rounded-suave border border-acero-claro bg-papel px-4 py-2 text-cuerpo text-tinta hover:border-acero"
                  >
                    Ver historial
                  </Link>
                </div>
              </Aviso>
            ) : (
              <div>
                <Boton
                  variante="principal"
                  grande
                  onClick={generarOrden}
                  disabled={pendientes.length > 0 || generando}
                >
                  {generando ? "Generando orden…" : "Generar orden"}
                </Boton>
              </div>
            )}
          </div>
        </div>
      </Tarjeta>

      {buscandoPara !== null && items[buscandoPara] && (
        <BuscadorProducto
          catalogo={catalogo}
          textoProveedor={items[buscandoPara].descripcion}
          alElegir={(productoId) => cambiarProducto(buscandoPara, productoId)}
          alCerrar={() => setBuscandoPara(null)}
          alCrearNuevo={() => abrirCreacion(buscandoPara)}
        />
      )}
    </div>
  );
}
