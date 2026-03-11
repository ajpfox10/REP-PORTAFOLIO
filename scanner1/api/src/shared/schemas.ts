import { z } from "zod"

export const paginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().min(0).default(0),
})

export const createDeviceSchema = z.object({
  name:       z.string().min(1).max(200),
  driver:     z.enum(["wia","twain","virtual"]).default("wia"),
  device_key: z.string().min(8).max(200),
  is_active:  z.boolean().default(true),
})

export const createProfileSchema = z.object({
  name:                  z.string().min(1).max(200),
  dpi:                   z.number().int().min(72).max(1200).default(300),
  color:                 z.boolean().default(true),
  auto_rotate:           z.boolean().default(true),
  blank_page_detection:  z.boolean().default(true),
  compression:           z.enum(["low","medium","high"]).default("medium"),
  output_format:         z.enum(["pdf","pdf_a","tiff"]).default("pdf"),
})

export const createScanJobSchema = z.object({
  device_id:    z.number().int().positive(),
  profile_id:   z.number().int().positive().optional(),
  priority:     z.number().int().min(0).max(10).default(0),
  // Integration: vincular el scan a un agente del backend personal
  personal_dni: z.number().int().positive().optional(),
  personal_ref: z.string().max(200).optional(),
})

export const webhookCreateSchema = z.object({
  url:       z.string().url(),
  events:    z.array(z.string().min(3)).min(1),
  secret:    z.string().min(16).max(200).optional(),
  is_active: z.boolean().default(true),
})

export const agentUploadSchema = z.object({
  job_id:       z.number().int().positive(),
  nonce:        z.string().min(8),
  pages:        z.number().int().min(1),
  storage_keys: z.array(z.string().min(1)).min(1),
})

export const searchSchema = z.object({
  q:            z.string().min(1).max(500),
  personal_dni: z.coerce.number().int().positive().optional(),
  doc_class:    z.string().optional(),
  limit:        z.coerce.number().int().min(1).max(100).default(20),
})
