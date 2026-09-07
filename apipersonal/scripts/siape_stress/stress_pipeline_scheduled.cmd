@echo off
REM Pipeline STRESS agendado (cada 72hs 16:30). Requiere sesion logueada con
REM SIAPE abierto en eRreH (el robot es GUI). Secuencia:
REM   1) descarga "Tiempo Acumulado" de Discoverer (Playwright)
REM   2) build cola (>=umbral, dedup) + robot JAB (carga, verifica, guarda, marca DB)
cd /d "%~dp0"
echo [%date% %time%] ===== descarga Tiempo Acumulado ===== >> stress_pipeline.log
node bajar_tiempo_acumulado.mjs >> stress_pipeline.log 2>&1
echo [%date% %time%] ===== carga stress (build + JAB) ===== >> stress_pipeline.log
node cargar_stress.mjs --all >> stress_pipeline.log 2>&1
echo [%date% %time%] ===== fin ===== >> stress_pipeline.log
