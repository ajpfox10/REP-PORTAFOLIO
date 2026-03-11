export class ApiError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message || code);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
export function errorHandler(err, req, res, _next) {
    const status = err?.status || 500;
    const code = err?.code || "internal_error";
    const message = err?.message || "internal_error";
    const request_id = req.request_id;
    res.status(status).json({
        error: code,
        message,
        request_id,
        details: err?.details
    });
}
