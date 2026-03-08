class NoneClassifier {
    async classify(_text) { return { doc_class: "unknown", confidence: 0 }; }
}
class NoneExtractor {
    async extract(_text, _docClass) { return {}; }
}
export function classifier() {
    const p = (process.env.AI_CLASSIFIER_PROVIDER || "none").toLowerCase();
    if (p === "none")
        return new NoneClassifier();
    // openai/aws_textract/custom can be added here
    return new NoneClassifier();
}
export function extractor() {
    const p = (process.env.AI_EXTRACTOR_PROVIDER || "none").toLowerCase();
    if (p === "none")
        return new NoneExtractor();
    return new NoneExtractor();
}
