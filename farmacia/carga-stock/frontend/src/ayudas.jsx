import React, { useState } from 'react';

// Explicaciones de cada pagina del portal: que es, de donde salen los datos y como se usa.
// "pestanas": explicacion de la pestaña / vista abierta (se pasa en la prop "sub").
export const AYUDAS = {
  dashboard: {
    que: 'Es la pantalla de inicio del Portal Farmacia. Muestra una tarjeta por cada módulo que tu usuario tiene habilitado: tocá una tarjeta para entrar.',
    datos: 'Los módulos dependen del rol del usuario (admin, operador o lector). Si sos admin, arriba aparece además el aviso de fármacos repetidos del último Stock Actual.',
    pasos: [
      'Tocá la tarjeta del módulo que necesitás.',
      'Para volver acá desde cualquier página usá el botón «Inicio» de arriba a la derecha.',
      'Cada página tiene este mismo recuadro «¿Qué es esta página?» con su explicación.'
    ]
  },
  stock: {
    que: 'Carga de Stock Crítico: prepara los valores nuevos de stock mínimo y máximo de los productos que en Farmacia MS figuran con guiones (sin mínimo/máximo) y los manda a cargar con el script.',
    datos: 'Toma automáticamente el ReporteStockCritico que dejes en la carpeta D:\\FARMACIA\\CRITICO (se revisa sola cada minuto; un archivo ya cargado no se repite).',
    pasos: [
      'Dejá el Excel del reporte de stock crítico en D:\\FARMACIA\\CRITICO y esperá a que aparezca como importado.',
      'Elegí la importación a trabajar y completá el mínimo y el máximo de cada producto (o aplicalos desde «Stock Sugeridos»).',
      'Los renglones con valores quedan «Listo (en cola script)».',
      'Ejecutá el script: entra a Farmacia MS y carga los valores. Cada renglón pasa a «Cargado» o queda con error.',
      'Abajo, «Ejecuciones de script» muestra el historial de cada corrida.'
    ]
  },
  consumo: {
    que: 'Consumo mensual (importación manual, módulo anterior): permite subir un Excel de consumo y ver el consumo por producto y por mes.',
    datos: 'Sale del Excel que importás con el botón «Importar consumo». Hoy el consumo se baja solo con el robot de «Consumo Mensual (Farmacia MS)».',
    pasos: [
      'Tocá «Importar consumo» y elegí el Excel.',
      'Buscá el producto por código o nombre para ver su consumo.'
    ]
  },
  comparar: {
    que: 'Comparar años: pone lado a lado el consumo de un mismo producto en distintos años, mes por mes.',
    datos: 'Usa los consumos ya importados en el portal.',
    pasos: [
      'Tildá los años que querés comparar y tocá «Comparar».',
      'Buscá un producto y abrí su renglón para ver el detalle por mes.'
    ]
  },
  trimestral: {
    que: 'Análisis Trimestral: muestra el consumo de cada producto por trimestre y calcula un stock mínimo y máximo sugeridos a partir de ese consumo.',
    datos: 'Lee solo los reportes «ConsumosDetallados» que dejes en D:\\FARMACIA\\TRIMESTRE (uno por trimestre, se revisa cada minuto). También los CODIGOSTODOS de años anteriores.',
    pasos: [
      'Dejá el reporte del trimestre en la carpeta y tocá «Actualizar» si no aparece.',
      '«Importados» muestra cada archivo cargado con sus productos.',
      '«Comparación por período» compara el consumo de un producto entre trimestres y semestres.',
      'Los mínimos y máximos calculados se usan después en «Stock Sugeridos».'
    ],
    pestanas: {
      items: 'Importados: los productos de cada reporte trimestral cargado, con su consumo mes a mes y el mínimo / máximo calculado.',
      comparacion: 'Comparación por período: el consumo de cada producto en cada trimestre o semestre, uno al lado del otro, para ver si sube o baja.'
    }
  },
  sugeridos: {
    que: 'Stock Sugeridos: un borrador de stock mínimo y máximo por código, calculado con el consumo del último trimestre. Lo revisás, lo corregís y recién ahí lo aplicás a Stock Crítico.',
    datos: 'Sale del Análisis Trimestral (consumo del semestre). El destino es la última importación de Stock Crítico (solo los productos con guiones).',
    pasos: [
      'Tocá «Generar / recalcular desde trimestre» para armar el borrador.',
      'Revisá cada renglón: podés cambiar el mínimo o el máximo haciendo clic en el número (queda marcado como «Editado»).',
      'Tocá «Aplicar a Stock Crítico»: los valores pasan a la carga de Stock Crítico listos para el script.'
    ]
  },
  rotulos: {
    que: 'Rótulos: arma e imprime la hoja completa de etiquetas para los fármacos (nombre, laboratorio, lote y vencimiento).',
    datos: 'Lo que escribís en el formulario. Cada impresión queda guardada en el «Historial de impresiones» de abajo.',
    pasos: [
      'Completá lote, vencimiento, nombre del fármaco y laboratorio.',
      'Ajustá ancho y alto del rótulo, tamaño y margen de la hoja, líneas de corte y letra, mirando la vista previa (los botones − / + cambian el zoom).',
      'Tocá «Imprimir».',
      'Para repetir un rótulo, buscalo en el «Historial de impresiones».'
    ]
  },
  ordenes: {
    que: 'Órdenes de Compra: lee los PDF de las O.C., arma el control de entregas renglón por renglón y lo sincroniza con la planilla de O.C. en Drive.',
    datos: 'Los PDF que subís desde la PC o desde una carpeta del servidor (los duplicados se descartan). Las entregas las cargás vos; «Control con Farmacia MS» trae lo ingresado desde Farmacia MS.',
    pasos: [
      '1. Cargá los PDF de O.C. («Subir PDF desde mi PC» o desde una carpeta).',
      'Abrí una O.C. con «Ver detalle» y cargá cantidad entregada, N° de ingreso y observación por renglón. Si la O.C. está INCOMPLETA podés sumar entregas parciales.',
      '2. Generá el Excel de control: «Descargar a mi PC» o «Guardar en servidor».',
      'La planilla de Drive se sincroniza sola en los dos sentidos.'
    ],
    pestanas: {
      ordenes: 'Órdenes de compra: la lista de O.C. cargadas con su estado (completa / incompleta), el detalle por renglón y el Excel de control.',
      cruce: 'Cruce con stock: compara lo comprado en las O.C. con el stock actual de Farmacia MS, y avisa productos parecidos por nombre que podrían ser el mismo con otro código.',
      control: 'Control con Farmacia MS: compara lo que cargaste como entregado con lo que Farmacia MS dice que ingresó, y muestra las O.C. con diferencias.'
    }
  },
  requerimiento: {
    que: 'Análisis de Requerimiento Anual: junta todos los PDF de requerimiento y los cruza con stock, consumo, vencimientos, O.C. y la comunicación del Ministerio, para revisar si lo pedido está bien.',
    datos: 'Lee los PDF que dejes en D:\\FARMACIA\\REQUERIMIENTO (se revisa cada minuto; un PDF duplicado no se carga dos veces). Los cruces usan lo que bajan los robots de Farmacia MS y las O.C.',
    pasos: [
      'Dejá los PDF en la carpeta (o tocá «Leer carpeta ahora»).',
      'Arriba ves el resumen: cantidad de requerimientos, ítems, códigos, repetidos y montos.',
      'Elegí la pestaña según lo que quieras revisar (abajo se explica la que tenés abierta).',
      'Para corregir un valor del PDF, en «Por código» hacé clic en el número de la columna «Requerido»: queda en «Correcciones» con el original.'
    ],
    pestanas: {
      codigo: 'Por código: un renglón por código con su droga, cuántas veces y en qué requerimientos se pidió, justiprecio y total. Podés agregar columnas (consumo, stock, vencimientos, O.C., bajas).',
      droga: 'Por droga: agrupa los códigos de la misma droga, forma y concentración, para ver el total pedido de cada droga aunque tenga varios códigos.',
      repetidos: 'Repetidos: los códigos que aparecen en más de un requerimiento. Sirve para detectar pedidos duplicados y cuánta plata suman.',
      items: 'Todos los ítems: cada renglón de cada PDF tal como vino (requerimiento, hoja, ítem, código, cantidad y precio).',
      stock: 'Cruce con stock: lo pedido en el ciclo contra el stock actual de Farmacia MS. Marca si el stock alcanza, sobra o falta, y lo que el Ministerio dijo NO.',
      oc: 'Cruce con O.C.: lo pedido contra lo comprado en las O.C. del mismo semestre. Los renglones de O.C. sin código se pueden «atar» al producto pedido que corresponde.',
      consumo: 'Pedido vs consumo: compara lo pedido con el consumo mensual promedio estimado, para ver si se pidió de más o de menos.',
      consumoSem: 'Consumo semestral: el consumo real de cada semestre según Farmacia MS (solo meses cerrados, con proyección si el semestre está incompleto), al lado del stock y lo pedido.',
      consumoNeto: 'Consumo y bajas: el consumo por semestre y, al lado, las bajas (descartes y vencidos), que no son consumo. Tocá un número de bajas para ver el detalle.',
      consumoVto: 'Consumo, pedido y vencimientos: stock estimado al inicio del ciclo, cuánto vence sin usarse y si el pedido se pisa con el stock que ya hay.',
      diferencias: 'Diferencias: productos comprados en O.C. de semestres anteriores que no están en el requerimiento (¿faltó pedirlos?), y al revés.',
      ministerio: 'Ministerio (habilitación): lo pedido contra la comunicación del Ministerio: qué está habilitado para comprar, qué es por 3 meses y qué dijo NO.',
      requerimientos: 'Requerimientos y archivos: la lista de PDF cargados (ciclo, número, período, ítems, total y alertas) y el estado de cada PDF de la carpeta.',
      correcciones: 'Correcciones: los valores del requerimiento que corregiste a mano, con el original del PDF, el nuevo, el motivo, quién y cuándo. El PDF no se modifica.'
    }
  },
  ministerio: {
    que: 'Habilitación Ministerio: carga la comunicación de compra del Ministerio y la cruza con lo pedido, para ver qué se puede comprar, qué es por 3 meses y qué dijo NO.',
    datos: 'El PDF de la comunicación del Ministerio que subís (tabla CÓDIGO / MEDICAMENTO / HABILITADO COMPRA), cruzado con los requerimientos cargados.',
    pasos: [
      'Subí el PDF de la comunicación del semestre o elegí una ya cargada en la lista.',
      '«Cruce con lo pedido» muestra cada producto pedido con lo que dijo el Ministerio y el monto sugerido.',
      '«Lista del Ministerio» muestra la comunicación completa tal como viene en el PDF.'
    ],
    pestanas: {
      cruce: 'Cruce con lo pedido: cada código pedido con lo que dijo el Ministerio (habilitado, por 3 meses o NO), el sugerido y el monto.',
      lista: 'Lista completa: todos los ítems de la comunicación del Ministerio, tal como vienen en el PDF.'
    }
  },
  carga2025: {
    que: 'Carga Requerimiento: la carga a mano del requerimiento por semestre (cuando no hay PDF). Además lo compara con el requerimiento del año siguiente para ver qué se pidió un año y el otro no.',
    datos: 'Lo que cargás vos (fármaco y cantidad por semestre). Las columnas extra (consumo, stock, vencimientos, O.C., PDF del año siguiente) salen de los otros módulos. «Códigos equivalentes» une el código viejo y el nuevo del mismo producto.',
    pasos: [
      'Elegí el semestre. Buscá el fármaco, poné la cantidad y guardá.',
      'Tildá «Contr.» cuando revisaste un renglón: pasa a la pestaña «Controlados».',
      '«Pedido en 2026 y no en 2027» y «Pedido en 2027 y no en 2026» comparan los dos años; los cuadros de colores explican el motivo de cada diferencia y filtran al tocarlos.',
      '«Códigos equivalentes» sugiere y guarda los pares de código viejo / código nuevo; en su pestaña «Historial» se ven y se deshacen.',
      '«Exportar a Excel» baja lo que muestra la tabla con los filtros aplicados.',
      'El recuadro «¿Cómo leer esta tabla?» explica cada columna y color.'
    ]
  },
  stockactual: {
    que: 'Stock Actual (Farmacia MS): un robot entra a Farmacia MS, baja la Consulta de Stock en Excel de cada sector y la guarda para que el resto del portal la use.',
    datos: 'Farmacia MS. Los Excel se guardan en la carpeta indicada (D:\\FARMACIA\\STOCK ACTUAL) y su contenido en la base.',
    pasos: [
      'Tocá «Descargar stock ahora» y esperá a que termine (dice «Descargando…» mientras trabaja).',
      'Buscá un producto para ver el stock por sector, lote y vencimiento.',
      'El aviso de «fármacos repetidos» muestra productos que figuran con más de un código.'
    ]
  },
  consumoms: {
    que: 'Consumo Mensual (Farmacia MS): un robot entra a Farmacia MS y baja el Consumo Comparativo mensual de cada sector y año, para comparar años y alimentar los análisis de requerimiento.',
    datos: 'Farmacia MS. Los Excel quedan en D:\\FARMACIA\\CONSUMO MENSUAL. Al correrlo también se leen las bajas (descartes y vencidos).',
    pasos: [
      'Tildá los años a bajar y tocá «Descargar consumo ahora».',
      'Cuando termina, buscá un producto para ver su consumo mes a mes en cada año.'
    ]
  },
  vencidos: {
    que: 'Vencimientos (Farmacia MS): un robot baja de Farmacia MS los lotes vencidos y por vencer de cada sector, y los muestra con un semáforo por lote.',
    datos: 'Farmacia MS. Los Excel quedan en D:\\FARMACIA\\VENCIDOS.',
    pasos: [
      'Elegí hasta cuándo («Lotes que vencen hasta») y tocá «Descargar vencimientos ahora».',
      'Cada lote dice si está vencido, vence en 30 días o menos, en 31 a 90 días o en más de 90 días (con color de fondo).',
      'Tocá el estado de un lote para ver solo los de ese estado (otra vez para ver todos).',
      'Buscá un producto para ver sus lotes y fechas.'
    ]
  },
  pendientesms: {
    que: 'Pendientes de Ingreso (Farmacia MS): un robot consulta en Farmacia MS, por N° de O.C., qué renglones faltan ingresar (adjudicado, ingresado y faltante).',
    datos: 'Farmacia MS, consultado con los números de O.C. que escribís o con todas las O.C. cargadas en «Órdenes de Compra».',
    pasos: [
      'Escribí uno o varios N° de O.C. (por ejemplo 683/2026, 452/26) y tocá «Consultar», o tocá «Consultar todas las O.C. cargadas».',
      'Esperá a que termine y revisá lo faltante de cada renglón.',
      'El resultado también se ve en Órdenes de Compra, pestaña «Control con Farmacia MS».'
    ]
  },
  usuarios: {
    que: 'Usuarios y permisos: alta de usuarios del portal y asignación de su rol.',
    datos: 'Admin: entra a todo. Operador: solo Rótulos. Lector: puede entrar pero no ve los módulos de carga.',
    pasos: [
      'Escribí usuario, contraseña inicial y rol, y tocá «Crear usuario».',
      'En la tabla podés cambiar el rol, desactivar un usuario (casilla «Activo») o ponerle una contraseña nueva, y guardar.'
    ]
  }
};

function leerOcultas() {
  try { return JSON.parse(localStorage.getItem('ayudasOcultas') || '{}') || {}; } catch { return {}; }
}

// Recuadro "¿Que es esta pagina?" debajo del titulo de cada pagina. Se puede ocultar (queda recordado).
export function AyudaPagina({ id, sub }) {
  const a = AYUDAS[id];
  const [ocultas, setOcultas] = useState(leerOcultas);
  if (!a) return null;
  const abierta = !ocultas[id];
  const cambiar = () => {
    const nuevo = { ...ocultas, [id]: abierta };
    setOcultas(nuevo);
    try { localStorage.setItem('ayudasOcultas', JSON.stringify(nuevo)); } catch { /* sin almacenamiento */ }
  };
  const textoSub = sub && a.pestanas ? a.pestanas[sub] : null;
  return (
    <section className={`ayuda-pagina ${abierta ? 'abierta' : ''}`}>
      <button type="button" className="ayuda-titulo" onClick={cambiar} aria-expanded={abierta}>
        <span className="ayuda-icono">?</span>
        <strong>¿Qué es esta página?</strong>
        <span className="ayuda-accion">{abierta ? 'Ocultar' : 'Ver explicación'}</span>
      </button>
      {abierta ? (
        <div className="ayuda-cuerpo">
          <p>{a.que}</p>
          <p><b>De dónde salen los datos:</b> {a.datos}</p>
          {a.pasos?.length ? (
            <>
              <b>Cómo se usa:</b>
              <ul>{a.pasos.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          ) : null}
          {textoSub ? <p className="ayuda-sub"><b>Lo que estás viendo ahora:</b> {textoSub}</p> : null}
        </div>
      ) : (textoSub ? <div className="ayuda-sub-corto">{textoSub}</div> : null)}
    </section>
  );
}
