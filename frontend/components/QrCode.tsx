"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface Props {
  value: string;
  size?: number;
}

export default function QrCode({ value, size = 160 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: "#ffffff", light: "#0f0f1a" },
    });
  }, [value, size]);

  return <canvas ref={canvasRef} style={{ borderRadius: 8 }} />;
}
