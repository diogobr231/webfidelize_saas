import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const brandLogo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/webfidelize-logo.png")).toString("base64")}`;

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
          background: "#f7f7f7",
          color: "#082942",
        }}
      >
        <div style={{ display: "flex", height: 90, alignItems: "center" }}>
          <img src={brandLogo} alt="Web Fidelize" width={480} height={160} />
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
          <span style={{ color: "#087c91" }}>Mais tempo para atender.</span>
        </div>
        <div style={{ display: "flex", fontSize: 27, color: "#475e70" }}>
          Agenda online · Clientes · Profissionais
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#087c91" }}>
          7 dias de teste · cartão obrigatório
        </div>
        <div style={{ display: "flex", fontSize: 18, color: "#475e70" }}>
          Ativação em preparação · primeira mensalidade após o teste
        </div>
      </div>
    ),
    size,
  );
}
