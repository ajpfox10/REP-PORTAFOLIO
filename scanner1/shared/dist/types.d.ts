export type TenantId = number;
export type DeviceId = number;
export type ScanJobId = number;
export type DocumentId = number;
export type ScanDriver = "wia" | "twain" | "virtual";
export type ScanJobStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";
export type DocClass = "invoice" | "id_card" | "medical_record" | "contract" | "resolution" | "certificate" | "unknown";
export type EventName = "scan.queued" | "scan.started" | "scan.page_uploaded" | "scan.completed" | "scan.failed" | "scan.canceled" | "ocr.started" | "ocr.completed" | "ocr.failed" | "ai.classified" | "ai.extracted" | "index.updated" | "document.created" | "document.deleted" | "agent.connected" | "agent.disconnected";
export interface ScanProfile {
    id: number;
    tenant_id: TenantId;
    name: string;
    dpi: number;
    color: boolean;
    auto_rotate: boolean;
    blank_page_detection: boolean;
    compression: "low" | "medium" | "high";
    output_format: "pdf" | "pdf_a" | "tiff";
    created_at: string;
}
export interface ScanJob {
    id: ScanJobId;
    tenant_id: TenantId;
    device_id: DeviceId;
    profile_id: number | null;
    priority: number;
    status: ScanJobStatus;
    page_count: number | null;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    personal_dni: number | null;
    personal_ref: string | null;
}
export interface AgentJobPoll {
    job_id: ScanJobId | null;
    profile: ScanProfile | null;
    personal_ref: string | null;
    nonce: string;
}
