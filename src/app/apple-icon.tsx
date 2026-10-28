import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const brandLogo = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/webfidelize-logo.png")).toString("base64")}`;

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f7f7",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "relative",
            width: 149,
            height: 100,
            overflow: "hidden",
          }}
        >
          <img
            src={brandLogo}
            alt=""
            width={480}
            height={160}
            style={{ position: "absolute", left: -17, top: -30 }}
          />
        </div>
      </div>
    ),
    size,
  );
}
