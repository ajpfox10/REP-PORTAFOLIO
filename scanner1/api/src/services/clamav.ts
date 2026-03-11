import net from "net"

export async function scanBufferWithClamAV(buf: Buffer): Promise<{ ok: boolean; virus?: string }> {
  // Minimal clamd INSTREAM protocol
  // If clamav is not running, fail-open in dev; change to fail-closed in prod.
  const host = "clamav"
  const port = 3310

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write("zINSTREAM\0")
      const size = Buffer.alloc(4)
      size.writeUInt32BE(buf.length, 0)
      socket.write(size)
      socket.write(buf)
      socket.write(Buffer.from([0,0,0,0]))
    })

    let data = ""
    socket.on("data", (chunk) => (data += chunk.toString("utf-8")))
    socket.on("error", () => resolve({ ok: true }))
    socket.on("end", () => {
      // expected: "stream: OK" or "stream: <virus> FOUND"
      if (/FOUND/i.test(data)) {
        const m = data.match(/stream:\s*(.+)\s*FOUND/i)
        resolve({ ok: false, virus: m?.[1] || "unknown" })
      } else {
        resolve({ ok: true })
      }
    })
  })
}
