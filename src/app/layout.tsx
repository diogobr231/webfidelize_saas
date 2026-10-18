import type { Metadata } from "next";
import { site } from "@/lib/seo";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: site.url,
  applicationName: "Web Fidelize",
  robots: { index: false, follow: false },
  title: "Web Fidelize | Seu negócio, mais conectado",
  description:
    "Agenda, clientes e equipe em uma plataforma para pequenos negócios.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
