-- ============================================================================
-- Código y grupo en el catálogo oficial de productos.
--
-- Fuente: Excel "Requisición Abastecimientos" (hoja Catalogo, columnas
-- Grupo | Codigo | Item | Unidad). El catálogo del sistema debe ser idéntico
-- a ese archivo: mismo nombre (Item) y mismo código.
--
-- El código NO lleva restricción de unicidad: la empresa reutiliza códigos
-- genéricos para categorías completas (p. ej. 511114 agrupa 55 artículos de
-- papelería) y existen nombres repetidos en grupos distintos con código
-- propio (p. ej. ARENA AMARILLA en construcción y en productos FTV).
-- ============================================================================

alter table productos_empresa
  add column if not exists codigo text,
  add column if not exists grupo text;

create index if not exists idx_productos_empresa_codigo
  on productos_empresa (codigo);
