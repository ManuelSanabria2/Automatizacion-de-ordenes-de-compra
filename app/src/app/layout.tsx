import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Marco } from "@/components/Marco";

// Archivo para todo lo que se lee: grotesca de origen señalético, ancha y con
// presencia, del mismo mundo que las señales de obra y las etiquetas de bodega.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Plex Mono SOLO para lo que se compara carácter a carácter: códigos, NIT,
// número de orden e importes. Ahí la rejilla monoespaciada evita errores de
// lectura; en la prosa solo estorba.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Órdenes de Compra — ENERCER",
  description:
    "Generación automática de órdenes de compra a partir de cotizaciones de proveedores",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-campo text-tinta">
        <Marco>{children}</Marco>
      </body>
    </html>
  );
}
