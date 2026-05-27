// queue.ts — Cola sin Redis, usando MySQL como backend
// BullMQ reemplazado por polling a scan_jobs + procesamiento inline.
// Compatible con la misma interfaz que usaban los routes.

import { pool } from "../db/mysql.js"
import { deliverWebhookToSubscribers } from "./webhook.js"
import { notifyPersonalApi } from "./personalIntegration.js"
import { storage } from "./storage.js"
import { Jimp } from "jimp"
import UTIF from "utif2"

// ── Interfaz mínima compatible con BullMQ Queue ───────────────────────────────
class MySQLQueue {
  readonly name: string
  constructor(name: string) { this.name = name }

  async add(_jobName: string, data: any, _opts?: any): Promise<{ id: string }> {
    if (this.name === "scan_queue") {
      const { scan_job_id, tenant_id } = data
      if (scan_job_id && data.storage_keys) {
        setImmediate(() => runPipeline(tenant_id, scan_job_id, data).catch(console.error))
      }
    }
    return { id: String(data.scan_job_id || Date.now()) }
  }
}

export const scanQueue  = new MySQLQueue("scan_queue")
export const ocrQueue   = new MySQLQueue("ocr_queue")
export const aiQueue    = new MySQLQueue("ai_queue")
export const indexQueue = new MySQLQueue("index_queue")

const PERSONAL_DOC_TYPES = new Set([
  "dni_frente",
  "dni_dorso",
  "titulo_secundario",
  "titulo_universitario",
  "licencia_conducir",
  "acta_nacimiento",
  "partida_matrimonio",
  "contrato_trabajo",
  "certificado_medico",
  "certificado_estudio",
  "recibo_sueldo",
  "declaracion_jurada",
  "resolucion",
  "nota_pedido",
  "jubilacion",
  "ioma",
  "foto_carnet",
  "cert_rotacion",
  "otro",
])

function isPdfBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 4).toString("ascii") === "%PDF"
}

function isPngBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
}

function isTiffBuffer(buf: Buffer): boolean {
  const sig4 = buf.subarray(0, 4).toString("ascii")
  return sig4 === "II*\u0000" || sig4 === "MM\u0000*"
}

function isJpegBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8
}

function getJpegInfo(buf: Buffer): { width: number; height: number; components: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("unsupported_image_format: only JPEG is supported for PDF assembly")
  }

  let offset = 2
  while (offset + 9 < buf.length) {
    while (offset < buf.length && buf[offset] !== 0xff) offset++
    while (offset < buf.length && buf[offset] === 0xff) offset++
    const marker = buf[offset]
    offset++

    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > buf.length) break
    const size = buf.readUInt16BE(offset)
    if (size < 2 || offset + size > buf.length) break

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSof) {
      const height = buf.readUInt16BE(offset + 3)
      const width = buf.readUInt16BE(offset + 5)
      const components = buf[offset + 7]
      return { width, height, components }
    }

    offset += size
  }

  throw new Error("jpeg_dimensions_not_found")
}

function buildPdfFromJpegs(images: Buffer[]): Buffer {
  const objects: Buffer[] = [Buffer.alloc(0)]
  const pageRefs: number[] = []
  const pagesRef = reserveObject(objects)
  const catalogRef = reserveObject(objects)

  for (const image of images) {
    const info = getJpegInfo(image)
    const imageRef = reserveObject(objects)
    const contentRef = reserveObject(objects)
    const pageRef = reserveObject(objects)

    const colorSpace =
      info.components === 1 ? "/DeviceGray" :
      info.components === 4 ? "/DeviceCMYK" :
      "/DeviceRGB"

    setObject(
      objects,
      imageRef,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
          "binary"
        ),
        image,
        Buffer.from("\nendstream", "binary"),
      ])
    )

    const content = `q\n${info.width} 0 0 ${info.height} 0 0 cm\n/Im0 Do\nQ\n`
    setObject(
      objects,
      contentRef,
      Buffer.from(
        `<< /Length ${Buffer.byteLength(content, "binary")} >>\nstream\n${content}endstream`,
        "binary"
      )
    )

    setObject(
      objects,
      pageRef,
      Buffer.from(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${info.width} ${info.height}] /Resources << /XObject << /Im0 ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`,
        "binary"
      )
    )
    pageRefs.push(pageRef)
  }

  setObject(objects, pagesRef, Buffer.from(`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] >>`, "binary"))
  setObject(objects, catalogRef, Buffer.from(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`, "binary"))

  const header = Buffer.from("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n", "binary")
  const bodyParts: Buffer[] = [header]
  const offsets: number[] = [0]
  let cursor = header.length

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = cursor
    const part = Buffer.concat([Buffer.from(`${i} 0 obj\n`, "binary"), objects[i], Buffer.from("\nendobj\n", "binary")])
    bodyParts.push(part)
    cursor += part.length
  }

  const xrefOffset = cursor
  const xrefLines = ["xref", `0 ${objects.length}`, "0000000000 65535 f "]
  for (let i = 1; i < objects.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n `)
  }
  const trailer = `trailer\n<< /Size ${objects.length} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  bodyParts.push(Buffer.from(`${xrefLines.join("\n")}\n${trailer}`, "binary"))
  return Buffer.concat(bodyParts)
}

function reserveObject(objects: Buffer[]): number {
  objects.push(Buffer.alloc(0))
  return objects.length - 1
}

function setObject(objects: Buffer[], ref: number, content: Buffer): void {
  objects[ref] = content
}

async function rasterToJpeg(buf: Buffer): Promise<Buffer> {
  if (isJpegBuffer(buf)) return buf
  const image = await Jimp.read(buf)
  return image.getBuffer("image/jpeg", { quality: 72 })
}

async function rasterToRgba(buf: Buffer): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  if (isTiffBuffer(buf)) {
    const ifds = (UTIF as any).decode(buf)
    const first = ifds?.[0]
    if (!first) throw new Error("tiff_decode_failed")
    ;(UTIF as any).decodeImage(buf, first)
    const rgba = (UTIF as any).toRGBA8(first) as Uint8Array
    return { rgba, width: first.width, height: first.height }
  }

  const image = await Jimp.read(buf)
  return {
    rgba: new Uint8Array(image.bitmap.data),
    width: image.bitmap.width,
    height: image.bitmap.height,
  }
}

function rgbaToRgb(rgba: Uint8Array): Buffer {
  const rgb = Buffer.alloc(Math.floor(rgba.length / 4) * 3)
  let j = 0
  for (let i = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i]
    rgb[j++] = rgba[i + 1]
    rgb[j++] = rgba[i + 2]
  }
  return rgb
}

function buildMultiPageTiff(pages: Array<{ width: number; height: number; rgb: Buffer }>): Buffer {
  const software = Buffer.from("scanner1\0", "ascii")
  const ifdOffsets: number[] = []
  const ifdBuffers: Buffer[] = []
  let cursor = 8

  const entryCount = 12
  for (const page of pages) {
    const extraSize = 6 + 8 + 8 + software.length
    const ifdSize = 2 + (entryCount * 12) + 4 + extraSize
    ifdOffsets.push(cursor)
    cursor += ifdSize
    const _ = page
  }

  const imageOffsets: number[] = []
  for (const page of pages) {
    imageOffsets.push(cursor)
    cursor += page.rgb.length
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]
    const ifd = Buffer.alloc(2 + (entryCount * 12) + 4 + 6 + 8 + 8 + software.length)
    let p = 0
    ifd.writeUInt16LE(entryCount, p); p += 2
    let extra = 2 + (entryCount * 12) + 4

    const writeEntry = (tag: number, type: number, count: number, value: number | Buffer) => {
      ifd.writeUInt16LE(tag, p); p += 2
      ifd.writeUInt16LE(type, p); p += 2
      ifd.writeUInt32LE(count, p); p += 4
      if (Buffer.isBuffer(value)) {
        const offset = ifdOffsets[pageIndex] + extra
        ifd.writeUInt32LE(offset, p); p += 4
        value.copy(ifd, extra)
        extra += value.length
      } else {
        ifd.writeUInt32LE(value, p); p += 4
      }
    }

    const bitsPerSample = Buffer.alloc(6)
    bitsPerSample.writeUInt16LE(8, 0)
    bitsPerSample.writeUInt16LE(8, 2)
    bitsPerSample.writeUInt16LE(8, 4)
    const xRes = Buffer.alloc(8)
    xRes.writeUInt32LE(300, 0)
    xRes.writeUInt32LE(1, 4)
    const yRes = Buffer.alloc(8)
    yRes.writeUInt32LE(300, 0)
    yRes.writeUInt32LE(1, 4)

    writeEntry(256, 4, 1, page.width)
    writeEntry(257, 4, 1, page.height)
    writeEntry(258, 3, 3, bitsPerSample)
    writeEntry(259, 3, 1, 1)
    writeEntry(262, 3, 1, 2)
    writeEntry(273, 4, 1, imageOffsets[pageIndex])
    writeEntry(277, 3, 1, 3)
    writeEntry(278, 4, 1, page.height)
    writeEntry(279, 4, 1, page.rgb.length)
    writeEntry(282, 5, 1, xRes)
    writeEntry(283, 5, 1, yRes)
    writeEntry(305, 2, software.length, software)

    ifd.writeUInt32LE(ifdOffsets[pageIndex + 1] || 0, 2 + (entryCount * 12))
    ifdBuffers.push(ifd)
  }

  const header = Buffer.alloc(8)
  header.write("II", 0, "ascii")
  header.writeUInt16LE(42, 2)
  header.writeUInt32LE(8, 4)

  return Buffer.concat([
    header,
    ...ifdBuffers,
    ...pages.map((page) => page.rgb),
  ])
}

async function buildStoredOutput(
  tenant_id: number,
  scan_job_id: number,
  requestedOutputFormat: string | undefined,
  pageBuffers: Buffer[]
): Promise<{ storage_key: string; mime_type: string }> {
  const effectiveOutputFormat = requestedOutputFormat === "pdf_a" ? "pdf" : requestedOutputFormat || "pdf"

  if (effectiveOutputFormat === "jpg") {
    if (pageBuffers.length !== 1) {
      throw new Error("jpg_single_page_only")
    }
    if (isPdfBuffer(pageBuffers[0])) {
      throw new Error("jpg_not_available_for_pdf_source")
    }
    const jpegBuffer = await rasterToJpeg(pageBuffers[0])
    const storedJpeg = await storage().put(jpegBuffer, ".jpg", "image/jpeg", `t${tenant_id}/j${scan_job_id}`)
    return { storage_key: storedJpeg.key, mime_type: "image/jpeg" }
  }

  if (effectiveOutputFormat === "tiff" && pageBuffers.length === 1 && !isPdfBuffer(pageBuffers[0])) {
    const raster = await rasterToRgba(pageBuffers[0])
    const tiffBuffer = Buffer.from((UTIF as any).encodeImage(raster.rgba, raster.width, raster.height))
    const storedTiff = await storage().put(tiffBuffer, ".tiff", "image/tiff", `t${tenant_id}/j${scan_job_id}`)
    return { storage_key: storedTiff.key, mime_type: "image/tiff" }
  }

  if (effectiveOutputFormat === "tiff" && pageBuffers.length > 1) {
    const rasterPages = await Promise.all(pageBuffers.map((buf) => rasterToRgba(buf)))
    const tiffBuffer = buildMultiPageTiff(
      rasterPages.map((page) => ({
        width: page.width,
        height: page.height,
        rgb: rgbaToRgb(page.rgba),
      }))
    )
    const storedTiff = await storage().put(tiffBuffer, ".tiff", "image/tiff", `t${tenant_id}/j${scan_job_id}`)
    return { storage_key: storedTiff.key, mime_type: "image/tiff" }
  }

  const jpegPages = await Promise.all(
    pageBuffers
      .filter((buf) => !isPdfBuffer(buf))
      .map((buf) => rasterToJpeg(buf))
  )

  const finalPdfBuffer =
    pageBuffers.length === 1 && isPdfBuffer(pageBuffers[0])
      ? pageBuffers[0]
      : buildPdfFromJpegs(jpegPages)
  const storedPdf = await storage().put(finalPdfBuffer, ".pdf", "application/pdf", `t${tenant_id}/j${scan_job_id}`)
  return { storage_key: storedPdf.key, mime_type: "application/pdf" }
}

async function runPipeline(
  tenant_id: number,
  scan_job_id: number,
  data: { storage_keys: string[]; page_count: number; personal_dni?: number; personal_ref?: string; output_format?: string }
) {
  try {
    const pageBuffers = await Promise.all(data.storage_keys.map((key) => storage().get(key)))
    const finalOutput = await buildStoredOutput(tenant_id, scan_job_id, data.output_format, pageBuffers)
    const storage_key = finalOutput.storage_key

    // 1. Crear documento principal apuntando al PDF consolidado
    const [docResult] = await pool.query(
      `INSERT INTO documents
         (tenant_id, scan_job_id, storage_key, mime_type, page_count,
          doc_class, personal_dni, personal_ref, created_at)
       VALUES (?,?,?,?,?,'unknown',?,?,now())`,
      [tenant_id, scan_job_id, storage_key, finalOutput.mime_type, data.page_count,
       data.personal_dni || null, data.personal_ref || null]
    )
    const doc_id = Number((docResult as any).insertId)

    // 2. Registrar páginas
    for (let i = 0; i < data.storage_keys.length; i++) {
      await pool.query(
        "INSERT INTO document_pages (tenant_id,document_id,page_number,storage_key,created_at) VALUES (?,?,?,?,now())",
        [tenant_id, doc_id, i + 1, data.storage_keys[i]]
      ).catch(() => {})
    }

    // 3. Clasificar por referencia
    let doc_class = "general"
    const ref = (data.personal_ref || "").toLowerCase()
    if (PERSONAL_DOC_TYPES.has(ref))                 doc_class = ref
    else if (/dni|documento|identidad/.test(ref))    doc_class = "identificacion"
    else if (/jubil|pension/.test(ref))              doc_class = "jubilacion"
    else if (/legajo|expediente/.test(ref))          doc_class = "legajo"
    else if (/certificado|cert/.test(ref))           doc_class = "certificado"
    else if (/titulo|diploma/.test(ref))             doc_class = "titulo"
    else if (/recibo|sueldo/.test(ref))              doc_class = "recibo_sueldo"
    else if (/pedido|solicitud/.test(ref))           doc_class = "solicitud"

    // 4. Actualizar documento con clase
    await pool.query(
      "UPDATE documents SET doc_class=?, search_text=? WHERE id=?",
      [doc_class, `${data.personal_ref || ""} ${doc_class}`.trim(), doc_id]
    )

    // 5. Marcar job completado localmente antes de cualquier integración externa
    await pool.query(
      "UPDATE scan_jobs SET status='completed', page_count=?, completed_at=now(), updated_at=now() WHERE tenant_id=? AND id=?",
      [data.page_count, tenant_id, scan_job_id]
    )

    await deliverWebhookToSubscribers(tenant_id, "scan.completed", {
      scan_job_id, document_id: doc_id, doc_class, page_count: data.page_count,
    })

    console.log(`[queue] ✅ job ${scan_job_id} → doc ${doc_id} (${doc_class}, ${data.page_count}p)`)

    // 6. Notificar a api_personal sin bloquear el cierre del job local
    if (data.personal_dni) {
      void notifyPersonalApi(tenant_id, {
        personal_dni: data.personal_dni,
        personal_ref: data.personal_ref || undefined,
        document_id: doc_id,
        scan_job_id,
        doc_class,
        page_count: data.page_count,
        storage_key,
      }).catch(() => {})
    }

  } catch (e: any) {
    console.error(`[queue] ❌ job ${scan_job_id} pipeline error:`, e?.message)
    await pool.query(
      "UPDATE scan_jobs SET status='failed', error_message=?, updated_at=now() WHERE tenant_id=? AND id=?",
      [e?.message || "pipeline_error", tenant_id, scan_job_id]
    ).catch(() => {})
  }
}
