import crypto from "crypto";
export function requestId() {
    return (req, res, next) => {
        const id = req.header("x-request-id") || crypto.randomUUID();
        req.request_id = id;
        res.setHeader("x-request-id", id);
        next();
    };
}
