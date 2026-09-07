# Documents ingestion

Estado real a fecha 2026-05-10.

## Categorias soportadas

`external_lab`
- Soporta ingesta automatica desde `POST /documents/inbox/:id/ingest`.
- Requiere documento asociado a paciente y PDF almacenado.
- Crea orden de laboratorio y guarda metadata de la ingesta.

`prescription`
- No tiene ingesta automatica.
- Usar carga manual, asociacion manual y flujo clinico downstream.

`medical_authorization`
- No tiene ingesta automatica.
- Usar carga manual y seguimiento operativo/manual.

`insurance_claim`
- No tiene ingesta automatica.
- Usar carga manual y seguimiento operativo/manual.

`vet_clinic_records`
- No tiene ingesta automatica.
- Usar carga manual y revision clinica/manual.

## Comportamiento de API

Cuando se intenta ingerir automaticamente una categoria no soportada, el servicio responde `501` con codigo `DOCUMENTS_INGESTION_NOT_IMPLEMENTED`.

## Notas operativas

La ruta automatica actual esta orientada solo a PDFs de laboratorio externo. Si se suman nuevas categorias, conviene implementarlas como adapters separados antes de expandir la vista frontend.
