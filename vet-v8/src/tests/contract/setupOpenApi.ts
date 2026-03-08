import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import jestOpenAPI from "jest-openapi";

const specPath = path.resolve(process.cwd(), "docs/openapi.generated.yaml");

beforeAll(() => {
  if (!fs.existsSync(specPath)) {
    throw new Error("Missing OpenAPI spec. Run: npm run build && npm run openapi:gen");
  }
  const spec = YAML.parse(fs.readFileSync(specPath, "utf-8"));
  jestOpenAPI(spec);
});
