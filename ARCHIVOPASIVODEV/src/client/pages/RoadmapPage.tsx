// Pagina guia para definir los proximos modulos sin crear pantallas vacias.
export function RoadmapPage() {
  return (
    <section className="page-content">
      <div className="page-title">
        <div>
          <h1>Archivo Pasivo</h1>
          <p>Estas son las paginas que conviene definir en orden antes de implementarlas.</p>
        </div>
      </div>

      <div className="roadmap-list">
        <article>
          <strong>1. Expedientes</strong>
          <span>Alta, busqueda, estado documental, persona relacionada y observaciones.</span>
        </article>
        <article>
          <strong>2. Cajas y ubicaciones</strong>
          <span>Caja, estante, sector fisico, rango de expedientes y disponibilidad.</span>
        </article>
        <article>
          <strong>3. Movimientos</strong>
          <span>Ingreso, prestamo, devolucion, transferencia y responsable.</span>
        </article>
        <article>
          <strong>4. Auditoria documental</strong>
          <span>Historial por expediente, usuario, fecha y accion.</span>
        </article>
      </div>
    </section>
  );
}
