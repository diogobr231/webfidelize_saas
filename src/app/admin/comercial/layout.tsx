import type { ReactNode } from "react";
import "../admin.css";
import "./sales-admin.css";

export const metadata = {
  title: "Central comercial | Web Fidelize",
  robots: { index: false, follow: false },
};

export default function SalesLayout({ children }: { children: ReactNode }) {
  return children;
}
