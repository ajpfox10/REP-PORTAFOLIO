export function validate(schema, pick) {
    return (req, _res, next) => {
        const parsed = schema.parse(req[pick]);
        req[pick] = parsed;
        next();
    };
}
