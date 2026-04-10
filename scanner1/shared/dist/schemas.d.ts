import { z } from "zod";
export declare const paginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    cursor: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    cursor: number;
}, {
    limit?: number | undefined;
    cursor?: number | undefined;
}>;
export declare const createDeviceSchema: z.ZodObject<{
    name: z.ZodString;
    driver: z.ZodDefault<z.ZodEnum<["wia", "twain", "virtual"]>>;
    device_key: z.ZodString;
    is_active: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    driver: "wia" | "twain" | "virtual";
    device_key: string;
    is_active: boolean;
}, {
    name: string;
    device_key: string;
    driver?: "wia" | "twain" | "virtual" | undefined;
    is_active?: boolean | undefined;
}>;
export declare const createProfileSchema: z.ZodObject<{
    name: z.ZodString;
    dpi: z.ZodDefault<z.ZodNumber>;
    color: z.ZodDefault<z.ZodBoolean>;
    auto_rotate: z.ZodDefault<z.ZodBoolean>;
    blank_page_detection: z.ZodDefault<z.ZodBoolean>;
    compression: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
    output_format: z.ZodDefault<z.ZodEnum<["pdf", "pdf_a", "tiff"]>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    dpi: number;
    color: boolean;
    auto_rotate: boolean;
    blank_page_detection: boolean;
    compression: "low" | "medium" | "high";
    output_format: "pdf" | "pdf_a" | "tiff";
}, {
    name: string;
    dpi?: number | undefined;
    color?: boolean | undefined;
    auto_rotate?: boolean | undefined;
    blank_page_detection?: boolean | undefined;
    compression?: "low" | "medium" | "high" | undefined;
    output_format?: "pdf" | "pdf_a" | "tiff" | undefined;
}>;
export declare const createScanJobSchema: z.ZodObject<{
    device_id: z.ZodNumber;
    profile_id: z.ZodOptional<z.ZodNumber>;
    priority: z.ZodDefault<z.ZodNumber>;
    source: z.ZodDefault<z.ZodEnum<["flatbed", "adf", "adf_duplex"]>>;
    duplex: z.ZodDefault<z.ZodBoolean>;
    personal_dni: z.ZodOptional<z.ZodNumber>;
    personal_ref: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    device_id: number;
    priority: number;
    source: "flatbed" | "adf" | "adf_duplex";
    duplex: boolean;
    profile_id?: number | undefined;
    personal_dni?: number | undefined;
    personal_ref?: string | undefined;
}, {
    device_id: number;
    profile_id?: number | undefined;
    priority?: number | undefined;
    source?: "flatbed" | "adf" | "adf_duplex" | undefined;
    duplex?: boolean | undefined;
    personal_dni?: number | undefined;
    personal_ref?: string | undefined;
}>;
export declare const webhookCreateSchema: z.ZodObject<{
    url: z.ZodString;
    events: z.ZodArray<z.ZodString, "many">;
    secret: z.ZodOptional<z.ZodString>;
    is_active: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    is_active: boolean;
    url: string;
    events: string[];
    secret?: string | undefined;
}, {
    url: string;
    events: string[];
    is_active?: boolean | undefined;
    secret?: string | undefined;
}>;
export declare const agentUploadSchema: z.ZodObject<{
    job_id: z.ZodNumber;
    nonce: z.ZodString;
    pages: z.ZodNumber;
    storage_keys: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    job_id: number;
    nonce: string;
    pages: number;
    storage_keys: string[];
}, {
    job_id: number;
    nonce: string;
    pages: number;
    storage_keys: string[];
}>;
export declare const searchSchema: z.ZodObject<{
    q: z.ZodString;
    personal_dni: z.ZodOptional<z.ZodNumber>;
    doc_class: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    q: string;
    personal_dni?: number | undefined;
    doc_class?: string | undefined;
}, {
    q: string;
    limit?: number | undefined;
    personal_dni?: number | undefined;
    doc_class?: string | undefined;
}>;
