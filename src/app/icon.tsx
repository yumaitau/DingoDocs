import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        background: "#963a23",
        color: "#fff8ef",
        fontSize: 17,
        fontWeight: 750,
      }}
    >
      D
    </div>,
    size,
  );
}
