@echo off
REM Corrida de carga STRESS lanzada por el Task Scheduler (sesion interactiva /IT)
REM para que el login llegue a la ventana de SIAPE. Usa la cola pendiente actual.
cd /d "%~dp0"
python cargar_stress_jab.py > stress_jab_todos.log 2>&1
