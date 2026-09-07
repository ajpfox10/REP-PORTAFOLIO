@echo off
REM Un solo clic: resetea los 'error' a 'pendiente' y carga TODOS los pendientes.
REM El robot abre SIAPE y loguea SOLO (WM_CHAR). No hace falta loguear a mano.
REM Correlo VOS (doble-clic) y no toques mouse/teclado mientras carga.
cd /d "%~dp0\.."
python -c "import cargar_stress_jab as S; cn=S.conn(); cur=cn.cursor(); cur.execute(\"UPDATE cola_carga_stress SET estado='pendiente', motivo=NULL WHERE estado='error'\"); cn.commit(); cn.close(); print('error->pendiente reseteados')"
python cargar_stress_jab.py
echo.
echo ===== TERMINO. Revisa arriba OK guardado / ya estaba / ERROR =====
pause
