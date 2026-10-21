import { ImageResponse } from "next/og";

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
          background: "#11151d",
        }}
      >
        <svg width="140" height="140" viewBox="0 0 64 64" fill="none">
          <path
            d="M12 18 24 47 34 23l7 15 11-20"
            stroke="#5eead4"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="52" cy="18" r="3.5" fill="#5eead4" />
        </svg>
      </div>
    ),
    size,
  );
}
