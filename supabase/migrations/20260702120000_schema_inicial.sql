-- ============================================================================
-- Migración inicial — Sistema de Generación Automática de Órdenes de Compra
-- Schema según sección 5 de INSTRUCCIONS.MD
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tablas
-- ----------------------------------------------------------------------------

-- Contador consecutivo por año (el número de orden se reinicia en 001 cada año)
create table contador_ordenes (
  anio int primary key,
  ultimo_numero int not null default 0
);

-- Catálogo interno — nombres oficiales de la empresa
create table productos_empresa (
  id uuid primary key default gen_random_uuid(),
  nombre_oficial text not null,
  unidad_default text,
  tasa_iva_default numeric default 19,
  created_at timestamptz default now()
);

-- Proveedores — se carga masivamente desde Excel, o se crea al vuelo si no existe
create table proveedores (
  nit text primary key,
  nombre text not null,
  direccion text,
  ciudad text,
  contacto text,
  telefono text,
  email text,
  actualizado_en timestamptz default now()
);

-- Alias por proveedor — aprendizaje de nomenclatura
create table alias_productos (
  id uuid primary key default gen_random_uuid(),
  proveedor_nit text not null,
  nombre_proveedor_texto text not null,
  producto_empresa_id uuid references productos_empresa(id),
  created_at timestamptz default now(),
  unique(proveedor_nit, nombre_proveedor_texto)
);

-- Órdenes de compra generadas
create table ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  numero_orden text unique not null,        -- ej: GCS-OC-COR-2026-001
  fecha date not null default current_date,
  proveedor_nit text references proveedores(nit),
  numero_cotizacion text,
  proyecto text,
  plazo_entrega text,
  forma_pago text,
  sitio_entrega text,
  tasa_iva numeric default 19,
  descuento_general_porcentaje numeric default 0,   -- descuento a nivel de toda la orden
  subtotal numeric,
  valor_descuento numeric default 0,
  iva numeric,
  total numeric,
  pdf_cotizacion_url text,                  -- referencia al PDF original en Supabase Storage
  documento_generado_url text,              -- referencia a la orden final generada
  created_at timestamptz default now()
);

create table ordenes_compra_items (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid references ordenes_compra(id) on delete cascade,
  item_num int,
  producto_empresa_id uuid references productos_empresa(id),
  descripcion_final text not null,          -- nombre oficial, CONGELADO al momento de la orden
  unidad text,
  cantidad numeric,
  valor_unitario numeric,
  descuento_porcentaje numeric default 0,   -- descuento a nivel de ítem
  valor_total numeric                       -- ya con descuento de ítem aplicado
);

-- ----------------------------------------------------------------------------
-- 2. Índices
-- ----------------------------------------------------------------------------
-- Las tres columnas de búsqueda frecuente pedidas ya quedan indexadas por sus
-- propios constraints (Postgres crea un índice único automáticamente):
--   * proveedores.nit                                  → primary key
--   * alias_productos(proveedor_nit, nombre_proveedor_texto) → unique
--   * ordenes_compra.numero_orden                      → unique
-- Se agregan índices de apoyo para las FKs consultadas con frecuencia:

create index idx_ordenes_compra_proveedor_nit on ordenes_compra (proveedor_nit);
create index idx_ordenes_compra_items_orden_id on ordenes_compra_items (orden_id);
create index idx_alias_productos_producto_empresa_id on alias_productos (producto_empresa_id);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security — single-tenant: solo usuarios autenticados
-- ----------------------------------------------------------------------------

alter table contador_ordenes enable row level security;
alter table productos_empresa enable row level security;
alter table proveedores enable row level security;
alter table alias_productos enable row level security;
alter table ordenes_compra enable row level security;
alter table ordenes_compra_items enable row level security;

-- Sin políticas para `anon`: el rol anónimo no tiene acceso a ninguna tabla.
-- `service_role` (backend FastAPI) salta RLS por diseño de Supabase.

create policy "autenticados acceso total" on contador_ordenes
  for all to authenticated using (true) with check (true);

create policy "autenticados acceso total" on productos_empresa
  for all to authenticated using (true) with check (true);

create policy "autenticados acceso total" on proveedores
  for all to authenticated using (true) with check (true);

create policy "autenticados acceso total" on alias_productos
  for all to authenticated using (true) with check (true);

create policy "autenticados acceso total" on ordenes_compra
  for all to authenticated using (true) with check (true);

create policy "autenticados acceso total" on ordenes_compra_items
  for all to authenticated using (true) with check (true);
