# personalv5-enterprise-api (fixed)

## Run (dev)
```bash
npm i
copy .env.example .env
npm run dev
```

## Build + Run (prod)
```bash
npm run build
npm start
```

## OpenAPI
- Default: `docs/openapi.yaml`
- Override:
  - CLI: `npm run dev -- --openapi=docs/openapi.yaml`
  - ENV: `OPENAPI_PATH=docs/openapi.yaml`

Generate a fresh spec from DB schema snapshot:
```bash
npm run openapi:export
```
