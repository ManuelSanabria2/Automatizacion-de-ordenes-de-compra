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
  unidad: string;
  cantidad: number;
  valor_unitario: number;
}

export interface CotizacionExtraida {
  proveedor: ProveedorExtraido;
  numero_cotizacion: string;
  items: ItemExtraido[];
}

// --- Resolución de nombres (resolucion_productos.py) ------------------------

export type OrigenResolucion = "alias" | "fuzzy" | "gemini" | "sin_match";

export interface Candidato {
  producto_empresa_id: string;
  nombre_oficial: string;
  codigo: string | null;
  score: number;
  justificacion: string | null;
}

export interface ResolucionItem {
  texto_proveedor: string;
  origen: OrigenResolucion;
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
