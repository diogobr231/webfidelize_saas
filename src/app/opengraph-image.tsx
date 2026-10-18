import { ImageResponse } from "next/og";

export const alt =
  "Web Fidelize — agenda online, clientes e profissionais em um só lugar.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function SocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#061222",
          color: "#f0f6ff",
        }}
      >
        <div style={{ display: "flex", fontSize: 38, fontWeight: 700 }}>
          web<span style={{ color: "#22e2ed" }}>fidelize</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 66,
            lineHeight: 1.12,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          <span>Mais organização.</span>
          <span style={{ color: "#22e2ed" }}>Mais tempo para atender.</span>
        </div>
        <div style={{ display: "flex", fontSize: 27, color: "#b6c7d9" }}>
          Agenda online · Clientes · Profissionais
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#22e2ed" }}>
          Teste grátis por 7 dias
        </div>
      </div>
    ),
    size,
  );
}
