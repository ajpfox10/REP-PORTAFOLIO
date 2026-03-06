// src/files/mimeSniffer.ts
import fs from "fs";

export type SniffResult = {
  mime: string;
  ext: string;
  kind:
    | "pdf"
    | "docx"
    | "xlsx"
    | "office-ole"
    | "jpg"
    | "png"
    | "gif"
    | "txt"
    | "bin";
};

function startsWith(buf: Buffer, sig: number[]) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

function isZip(buf: Buffer) {
  // PK\x03\x04 (zip local header)
  return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
}

function isOle(buf: Buffer) {
  // D0 CF 11 E0 A1 B1 1A E1 (OLE2: doc/xls antiguos)
  return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

export function sniffFileMagic(filePath: string): SniffResult {
  // leemos un pedacito para detectar firma
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);

    // PDF
    if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
      return { mime: "application/pdf", ext: "pdf", kind: "pdf" };
    }

    // PNG
    if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return { mime: "image/png", ext: "png", kind: "png" };
    }

    // JPG
    if (startsWith(head, [0xff, 0xd8, 0xff])) {
      return { mime: "image/jpeg", ext: "jpg", kind: "jpg" };
    }

    // GIF
    if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) {
      return { mime: "image/gif", ext: "gif", kind: "gif" };
    }

    // OLE2 (doc/xls viejos)
    if (isOle(head)) {
      return { mime: "application/vnd.ms-office", ext: "bin", kind: "office-ole" };
    }

    // ZIP (docx/xlsx son zip, pero distinguir sin parsear todo es difícil)
    // Si querés precisión total, necesitaríamos inspeccionar entries ZIP.
    // Para seguridad, permitimos “office-openxml” genérico.
    if (isZip(head)) {
      return {
        mime: "application/vnd.openxmlformats-officedocument",
        ext: "zip",
        kind: "bin",
      };
    }

    // Texto (heurística)
    const sample = head.subarray(0, 2048);
    const nonPrintable = [...sample].filter((b) => b < 9 || (b > 13 && b < 32)).length;
    if (sample.length && nonPrintable / sample.length < 0.02) {
      return { mime: "text/plain; charset=utf-8", ext: "txt", kind: "txt" };
    }

    return { mime: "application/octet-stream", ext: "bin", kind: "bin" };
  } finally {
    fs.closeSync(fd);
  }
}
