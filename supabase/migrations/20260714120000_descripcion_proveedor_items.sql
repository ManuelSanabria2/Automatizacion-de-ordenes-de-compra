-- Guarda el nombre ORIGINAL del proveedor (tal como aparece en la cotización)
-- junto al nombre oficial congelado, para poder regenerar el documento de la
-- orden en dos variantes: "empresa" (descripcion_final) y "proveedor"
-- (descripcion_proveedor). Órdenes emitidas antes de esta migración no tienen
-- el dato: en esas la variante "proveedor" cae al nombre oficial.

alter table ordenes_compra_items
  add column descripcion_proveedor text;
