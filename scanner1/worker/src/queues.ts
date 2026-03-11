// queues.ts — stub sin Redis (el procesamiento lo hace el API inline)
// Si en el futuro se instala Redis 5+, reemplazar por bullmq real

export const scanQueue  = { add: async () => {} }
export const ocrQueue   = { add: async () => {} }
export const aiQueue    = { add: async () => {} }
export const indexQueue = { add: async () => {} }
