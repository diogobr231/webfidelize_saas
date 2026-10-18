import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Web Fidelize | Seu negócio, mais conectado', description: 'Agenda, clientes e equipe em uma plataforma para pequenos negócios.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
