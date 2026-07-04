// Traspaso en memoria del PDF original de la cotización entre la subida y la
// generación de la orden (un File no cabe en sessionStorage). Si el usuario
// recarga la página durante la revisión, la orden se genera igual pero sin
// adjuntar el PDF original a Storage.

let archivo: File | null = null;

export function guardarPdfCotizacion(pdf: File) {
  archivo = pdf;
}

export function obtenerPdfCotizacion(): File | null {
  return archivo;
}

export function limpiarPdfCotizacion() {
  archivo = null;
}
