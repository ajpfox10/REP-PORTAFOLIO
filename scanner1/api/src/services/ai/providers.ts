export type DocClass = "invoice" | "id_card" | "medical_record" | "contract" | "unknown"

export interface Classifier {
  classify(text: string): Promise<{ doc_class: DocClass; confidence: number }>
}

export interface Extractor {
  extract(text: string, docClass: DocClass): Promise<Record<string, any>>
}

class NoneClassifier implements Classifier {
  async classify(_text: string) { return { doc_class: "unknown" as const, confidence: 0 } }
}

class NoneExtractor implements Extractor {
  async extract(_text: string, _docClass: DocClass) { return {} }
}

export function classifier(): Classifier {
  const p = (process.env.AI_CLASSIFIER_PROVIDER || "none").toLowerCase()
  if (p === "none") return new NoneClassifier()
  // openai/aws_textract/custom can be added here
  return new NoneClassifier()
}

export function extractor(): Extractor {
  const p = (process.env.AI_EXTRACTOR_PROVIDER || "none").toLowerCase()
  if (p === "none") return new NoneExtractor()
  return new NoneExtractor()
}
