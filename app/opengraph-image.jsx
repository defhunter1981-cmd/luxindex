import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Fernhollow × LuxeIndex — Editorial Beauty Price Index";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #141310 0%, #1A1614 55%, #0E0D0B 100%)",
          padding: "72px 84px",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            letterSpacing: 6,
            color: "#B8976B",
            textTransform: "uppercase",
          }}
        >
          Fernhollow × LuxeIndex
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              color: "#F4ECE2",
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            The Editorial Beauty
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              color: "#D4B896",
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            Price Index
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 26,
              color: "#9A8C7D",
              maxWidth: 720,
              lineHeight: 1.4,
            }}
          >
            Verified, variant-matched pricing across Sephora, Nykaa, Amazon
            Luxury, Cult Beauty & Space NK — observed, never invented.
          </div>
          <div
            style={{
              display: "flex",
              width: 220,
              height: 3,
              background: "linear-gradient(90deg, #B8976B, rgba(184,151,107,0))",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
