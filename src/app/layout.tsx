import type { Metadata } from "next";
import localFont from "next/font/local";
import { site } from "@/lib/seo";
import "./globals.css";
import "./motion.css";
import { MotionPreference } from "@/components/ui/motion-preference";
const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "100 900",
});
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
    <html lang="pt-BR" className={geist.variable}>
      <body>
        <MotionPreference />
        {children}
      </body>
    </html>
  );
}
