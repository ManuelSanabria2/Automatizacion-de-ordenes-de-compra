// Tipos espejo de los modelos Pydantic del backend FastAPI y utilidades
// compartidas para consumir su API.

export const API_URL = process.env.NEXT_PUBLIC_API_URL;

const CLAVE_API = process.env.NEXT_PUBLIC_CLAVE_API;

/** fetch contra el backend: antepone API_URL y adjunta la clave API
 *  (header X-API-Key) si está configurada. Usar siempre este wrapper en vez
 *  de fetch crudo para que todas las llamadas queden autenticadas. */
export function fetchApi(ruta: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (CLAVE_API) headers.set("X-API-Key", CLAVE_API);
  return fetch(`${API_URL}${ruta}`, { ...init, headers });
}

// --- Extracción de cotizaciones (extraccion_cotizaciones.py) ---------------

export interface ProveedorExtraido {
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
}

export interface ItemExtraido {
  descripcion: string;
  referencia: string; // código/SKU del proveedor, si su cotización lo trae
  unidad: string;
  cantidad: number;
  valor_unitario: number;
}

/** Totales tal como están impresos en el PDF: cifra de control contra filas omitidas. */
export interface TotalesExtraidos {
  subtotal: number;
  iva: number;
  total: number;
}

export interface CotizacionExtraida {
  proveedor: ProveedorExtraido;
  numero_cotizacion: string;
  items: ItemExtraido[];
  totales_pdf: TotalesExtraidos;
}

// --- Resolución de nombres (resolucion_productos.py) ------------------------

export type OrigenResolucion =
  | "alias"
  | "historico" // confirmado antes por otro proveedor o en una orden anterior
  | "fuzzy"
  | "gemini"
  | "sin_match";

/** Banda de confianza para el semáforo de la revisión. No auto-confirma nada. */
export type NivelResolucion = "alta" | "media" | "baja";

export interface Candidato {
  producto_empresa_id: string;
  nombre_oficial: string;
  codigo: string | null;
  grupo: string | null;
  score: number;
  justificacion: string | null;
}

export interface ItemResolver {
  texto: string;
  unidad: string;
  referencia: string;
}

export interface ResolucionItem {
  texto_proveedor: string;
  origen: OrigenResolucion;
  nivel: NivelResolucion;
  confianza: number;
  candidatos: Candidato[];
}

export interface RespuestaResolucion {
  resoluciones: ResolucionItem[];
  advertencias: string[];
}

// --- Catálogo y proveedores --------------------------------------------------

export interface Producto {
  id: string;
  nombre_oficial: string;
  codigo: string | null;
  grupo: string | null;
  unidad_default: string | null;
  tasa_iva_default: number;
}

export interface Proveedor {
  nit: string;
  nombre: string;
  direccion: string | null;
  ciudad: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
}

// --- Órdenes de compra (generacion_ordenes.py) -------------------------------

export interface TotalesOrden {
  subtotal: number;
  valor_descuento: number;
  base_iva: number;
  iva: number;
  total: number;
}

export interface OrdenGenerada {
  id: string;
  numero_orden: string;
  fecha: string;
  totales: TotalesOrden;
  documento_path: string;
  pdf_cotizacion_path: string | null;
}

export interface OrdenResumen {
  id: string;
  numero_orden: string;
  fecha: string;
  proveedor_nit: string | null;
  proveedor_nombre: string | null;
  total: number | null;
}

/** Abre el documento oficial de una orden (URL firmada por el backend).
 *  Devuelve un mensaje de error, o null si se abrió correctamente. */
export async function abrirDocumentoOrden(ordenId: string): Promise<string | null> {
  try {
    const res = await fetchApi(`/ordenes/${ordenId}/documento`);
    if (!res.ok) return await extraerDetalle(res, "No se pudo obtener el documento");
    const { url } = (await res.json()) as { url: string };
    window.open(url, "_blank", "noopener");
    return null;
  } catch {
    return ERROR_CONEXION;
  }
}

export type VarianteDocumento = "empresa" | "proveedor";

/** Regenera y descarga el Excel de una orden en la variante indicada:
 *  "empresa" imprime los nombres del catálogo; "proveedor" los nombres
 *  originales de la cotización. El backend transmite el archivo (con la clave
 *  API), así que se descarga como blob. Devuelve un mensaje de error, o null. */
export async function descargarDocumentoOrden(
  ordenId: string,
  variante: VarianteDocumento,
  nombreArchivo: string,
): Promise<string | null> {
  try {
    const res = await fetchApi(`/ordenes/${ordenId}/descargar?variante=${variante}`);
    if (!res.ok) return await extraerDetalle(res, "No se pudo descargar el documento");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombreArchivo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    return null;
  } catch {
    return ERROR_CONEXION;
  }
}

// --- Traspaso subida → revisión (sessionStorage) -----------------------------

export const CLAVE_REVISION = "cotizacion_revision";

export interface RevisionPendiente {
  cotizacion: CotizacionExtraida;
  resolucion: RespuestaResolucion;
  nombreArchivo: string;
}

// --- Utilidades ----------------------------------------------------------------

export const ERROR_CONEXION =
  "No se pudo conectar con el servidor. Verifica que el backend esté activo.";

export async function extraerDetalle(res: Response, porDefecto: string): Promise<string> {
  try {
    const datos = await res.json();
    if (typeof datos.detail === "string") return datos.detail;
    // Errores de validación de FastAPI (422): lista de objetos con `msg`.
    if (Array.isArray(datos.detail) && datos.detail[0]?.msg) return datos.detail[0].msg;
  } catch {
    // cuerpo no-JSON: se usa el mensaje por defecto
  }
  return porDefecto;
}

export function formatoCOP(valor: number): string {
  return valor.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  });
}
