'use strict';

/**
 * shared/multibranch.js
 * Lógica de negocio multi-sucursal:
 *   - Verificar pertenencia al mismo org
 *   - Cálculo de KPIs consolidados
 *   - Helpers de transferencia (pacientes, stock)
 *   - Cross-branch access guard
 */

const db = require('./db');

// ─── Guards de pertenencia ────────────────────────────────────────────────────

/**
 * Verifica que ambas sucursales pertenezcan al mismo org.
 * Lanza error si no.
 */
async function assertSameOrg (branchIdA, branchIdB) {
  const [a, b] = await Promise.all([
    db.queryOne('SELECT organization_id FROM branches WHERE id = :id', { id: branchIdA }),
    db.queryOne('SELECT organization_id FROM branches WHERE id = :id', { id: branchIdB }),
  ]);
  if (!a || !b) throw Object.assign(new Error('Sucursal no encontrada'), { code: 'BRANCH_NOT_FOUND' });
  if (a.organization_id !== b.organization_id) {
    throw Object.assign(new Error('Las sucursales pertenecen a organizaciones distintas'), { code: 'CROSS_ORG_DENIED' });
  }
  return true;
}

/**
 * Verifica que el usuario tenga acceso a la sucursal destino (mismo org).
 */
async function assertBranchAccess (userId, branchId) {
  const row = await db.queryOne(
    `SELECT u.id FROM users u
     JOIN branches b ON b.organization_id = u.organization_id
     WHERE u.id = :uid AND b.id = :bid`,
    { uid: userId, bid: branchId }
  );
  if (!row) throw Object.assign(new Error('Sin acceso a la sucursal'), { code: 'BRANCH_ACCESS_DENIED' });
  return true;
}

/**
 * Devuelve todas las sucursales del org del usuario.
 */
async function getOrgBranches (orgId) {
  return db.query(
    `SELECT id, name, address, phone, timezone, is_active
     FROM branches WHERE organization_id = :orgId ORDER BY name`,
    { orgId }
  );
}

// ─── Transferencia de pacientes ───────────────────────────────────────────────

/**
 * Registra y ejecuta una transferencia de paciente entre sucursales.
 * El paciente mantiene su historial completo — solo cambia el cliente "principal"
 * a la sucursal destino.
 *
 * @param {object} opts
 * @param {number} opts.patientId
 * @param {number} opts.fromBranchId
 * @param {number} opts.toBranchId
 * @param {number} opts.clientId        — cliente en destino (puede ser el mismo o diferente)
 * @param {number} opts.requestedByUserId
 * @param {string} [opts.reason]
 * @param {boolean} [opts.transferOwnership] — si true, mueve la propiedad del cliente
 * @returns {Promise<{ transferId }>}
 */
async function transferPatient (opts) {
  const { patientId, fromBranchId, toBranchId, clientId, requestedByUserId, reason, transferOwnership = false } = opts;

  if (fromBranchId === toBranchId) {
    throw Object.assign(new Error('Origen y destino son la misma sucursal'), { code: 'SAME_BRANCH' });
  }
  await assertSameOrg(fromBranchId, toBranchId);

  const transferId = await db.transaction(async (conn) => {
    const patient = await conn.queryOne(
      `SELECT p.id, p.name
       FROM patients p
       JOIN patient_owners po ON po.patient_id = p.id AND po.ownership_type = 'primary'
       JOIN clients cl ON po.client_id = cl.id AND cl.branch_id = :bid
       WHERE p.id = :pid
       FOR UPDATE`,
      { pid: patientId, bid: fromBranchId }
    );
    if (!patient) throw Object.assign(new Error('Paciente no encontrado en sucursal origen'), { code: 'PATIENT_NOT_FOUND' });

    if (transferOwnership) {
      const destinationClient = await conn.queryOne(
        `SELECT c.id
         FROM clients c
         JOIN branches b ON b.id = c.branch_id
         JOIN branches source ON source.id = :fromBranchId
         WHERE c.id = :clientId
           AND c.branch_id = :toBranchId
           AND b.organization_id = source.organization_id
           AND c.is_active = TRUE
           AND c.deleted_at IS NULL`,
        { clientId, toBranchId, fromBranchId }
      );
      if (!destinationClient) {
        throw Object.assign(new Error('Cliente destino invalido'), { code: 'CLIENT_NOT_FOUND' });
      }
    }

    const [result] = await conn.query(
      `INSERT INTO patient_transfers
         (patient_id, from_branch_id, to_branch_id, client_id,
          requested_by, transfer_type, reason, status)
       VALUES (:pid, :from, :to, :cid, :uid, :transferType, :reason, 'completed')`,
      {
        pid: patientId,
        from: fromBranchId,
        to: toBranchId,
        cid: clientId,
        uid: requestedByUserId,
        transferType: transferOwnership ? 'ownership' : 'visit',
        reason: reason || null,
      }
    );

    if (transferOwnership) {
      await conn.query(
        `UPDATE patient_owners SET client_id = :cid, updated_at = NOW()
         WHERE patient_id = :pid AND ownership_type = 'primary'`,
        { cid: clientId, pid: patientId }
      );
    }

    return result.insertId;
  });

  return { transferId };
}

// ─── Transferencia de stock ───────────────────────────────────────────────────

/**
 * Transfiere unidades de inventario de una sucursal a otra.
 * Descuenta del origen e incrementa en destino.
 *
 * @param {object} opts
 * @returns {Promise<{ transferId }>}
 */
async function transferStock (opts) {
  const { itemId, fromBranchId, toBranchId, quantity, requestedByUserId, reason, batchId } = opts;
  const transferQuantity = Number(quantity);

  if (fromBranchId === toBranchId) throw Object.assign(new Error('Misma sucursal'), { code: 'SAME_BRANCH' });
  await assertSameOrg(fromBranchId, toBranchId);
  if (!Number.isFinite(transferQuantity) || transferQuantity <= 0) {
    throw Object.assign(new Error('Cantidad de transferencia invalida'), { code: 'INVALID_QUANTITY' });
  }

  let transferId;
  await db.transaction(async (conn) => {
    const stock = await conn.queryOne(
      `SELECT quantity_available, minimum_stock, reorder_point, maximum_stock
       FROM inventory_stock
       WHERE item_id = :itemId AND branch_id = :branchId
       FOR UPDATE`,
      { itemId, branchId: fromBranchId }
    );
    if (!stock) throw Object.assign(new Error('Ítem no encontrado en sucursal origen'), { code: 'ITEM_NOT_FOUND' });
    if (Number(stock.quantity_available) < transferQuantity) {
      throw Object.assign(
        new Error(`Stock insuficiente: disponible ${stock.quantity_available}, solicitado ${transferQuantity}`),
        { code: 'INSUFFICIENT_STOCK' }
      );
    }

    let batch = null;
    if (batchId) {
      batch = await conn.queryOne(
        `SELECT id, supplier_id, lot_number, manufacture_date, expiry_date,
                quantity_available, unit_cost, notes
         FROM inventory_batches
         WHERE id = :batchId AND item_id = :itemId AND branch_id = :branchId
           AND deleted_at IS NULL
         FOR UPDATE`,
        { batchId, itemId, branchId: fromBranchId }
      );
      if (!batch) throw Object.assign(new Error('Lote no encontrado en sucursal origen'), { code: 'ITEM_NOT_FOUND' });
      if (Number(batch.quantity_available) < transferQuantity) {
        throw Object.assign(
          new Error(`Stock insuficiente en lote: disponible ${batch.quantity_available}, solicitado ${transferQuantity}`),
          { code: 'INSUFFICIENT_STOCK' }
        );
      }
    }

    const [r] = await conn.query(
      `INSERT INTO stock_transfers
         (item_id, from_branch_id, to_branch_id, quantity, batch_id, requested_by, reason, status)
       VALUES (:itemId, :fromBranchId, :toBranchId, :quantity, :batchId, :requestedBy, :reason, 'completed')`,
      {
        itemId,
        fromBranchId,
        toBranchId,
        quantity: transferQuantity,
        batchId: batchId || null,
        requestedBy: requestedByUserId,
        reason: reason || null,
      }
    );
    transferId = r.insertId;

    await conn.query(
      `UPDATE inventory_stock
       SET quantity_available = quantity_available - :quantity, updated_at = NOW()
       WHERE item_id = :itemId AND branch_id = :branchId`,
      { quantity: transferQuantity, itemId, branchId: fromBranchId }
    );

    await conn.query(
      `INSERT INTO inventory_stock
         (item_id, branch_id, quantity_available, minimum_stock, reorder_point, maximum_stock)
       VALUES (:itemId, :branchId, :quantity, :minimumStock, :reorderPoint, :maximumStock)
       ON DUPLICATE KEY UPDATE
         quantity_available = inventory_stock.quantity_available + VALUES(quantity_available),
         updated_at = NOW()`,
      {
        itemId,
        branchId: toBranchId,
        quantity: transferQuantity,
        minimumStock: stock.minimum_stock ?? 0,
        reorderPoint: stock.reorder_point ?? 0,
        maximumStock: stock.maximum_stock ?? null,
      }
    );

    if (batch) {
      await conn.query(
        `UPDATE inventory_batches
         SET quantity_available = quantity_available - :quantity
         WHERE id = :batchId`,
        { quantity: transferQuantity, batchId }
      );
      const destinationBatch = await conn.queryOne(
        `SELECT id FROM inventory_batches
         WHERE item_id = :itemId AND branch_id = :branchId AND lot_number = :lotNumber
           AND expiry_date <=> :expiryDate AND supplier_id <=> :supplierId
           AND deleted_at IS NULL
         LIMIT 1 FOR UPDATE`,
        {
          itemId,
          branchId: toBranchId,
          lotNumber: batch.lot_number,
          expiryDate: batch.expiry_date,
          supplierId: batch.supplier_id,
        }
      );
      if (destinationBatch) {
        await conn.query(
          `UPDATE inventory_batches
           SET quantity_received = quantity_received + :quantity,
               quantity_available = quantity_available + :quantity
           WHERE id = :batchId`,
          { quantity: transferQuantity, batchId: destinationBatch.id }
        );
      } else {
        await conn.query(
          `INSERT INTO inventory_batches
             (item_id, branch_id, supplier_id, lot_number, manufacture_date, expiry_date,
              quantity_received, quantity_available, unit_cost, notes, created_by)
           VALUES
             (:itemId, :branchId, :supplierId, :lotNumber, :manufactureDate, :expiryDate,
              :quantity, :quantity, :unitCost, :notes, :createdBy)`,
          {
            itemId,
            branchId: toBranchId,
            supplierId: batch.supplier_id,
            lotNumber: batch.lot_number,
            manufactureDate: batch.manufacture_date,
            expiryDate: batch.expiry_date,
            quantity: transferQuantity,
            unitCost: batch.unit_cost,
            notes: batch.notes,
            createdBy: requestedByUserId,
          }
        );
      }
    }
  });

  return { transferId };
}

// ─── KPIs consolidados ────────────────────────────────────────────────────────

/**
 * Calcula KPIs financieros consolidados para todo el org en un período.
 * @param {number} orgId
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 * @returns {Promise<object>}
 */
async function consolidatedFinancials (orgId, from, to) {
  const [revenue, branches, topClients] = await Promise.all([
    // Revenue total por sucursal
    db.query(
      `SELECT b.name AS branch_name, b.id AS branch_id,
              COUNT(DISTINCT i.id) AS invoices,
              ROUND(SUM(i.total_amount), 2) AS gross_revenue,
              ROUND(SUM(i.paid_amount),  2) AS collected,
              ROUND(SUM(i.total_amount - i.paid_amount), 2) AS outstanding
       FROM invoices i
       JOIN branches b ON i.branch_id = b.id
       WHERE b.organization_id = :orgId
         AND i.issued_date BETWEEN :from AND :to
         AND i.status != 'cancelled'
       GROUP BY b.id ORDER BY gross_revenue DESC`,
      { orgId, from, to }
    ),

    // Métricas de pacientes y citas por sucursal
    db.query(
      `SELECT b.id AS branch_id, b.name AS branch_name,
              COUNT(DISTINCT p.id) AS active_patients,
              COUNT(DISTINCT a.id) AS appointments,
              ROUND(SUM(a.status = 'completed') * 100.0 / NULLIF(COUNT(a.id), 0), 2) AS completion_rate
       FROM branches b
       LEFT JOIN clients cl ON cl.branch_id = b.id
       LEFT JOIN patient_owners po ON po.client_id = cl.id AND po.ownership_type = 'primary'
       LEFT JOIN patients p ON po.patient_id = p.id AND p.is_active = TRUE
       LEFT JOIN appointments a ON a.branch_id = b.id
        AND a.scheduled_date >= :from
        AND a.scheduled_date < DATE_ADD(:to, INTERVAL 1 DAY)
       WHERE b.organization_id = :orgId AND b.is_active = TRUE
       GROUP BY b.id ORDER BY b.name`,
      { orgId, from, to }
    ),

    // Top clientes del org (cross-branch)
    db.query(
      `SELECT CONCAT(cl.first_name,' ',cl.last_name) AS client_name, cl.email,
              b.name AS primary_branch,
              SUM(i.total_amount) AS total_spent, COUNT(DISTINCT i.id) AS total_invoices,
              COUNT(DISTINCT po.patient_id) AS total_patients
       FROM clients cl
       JOIN branches b ON cl.branch_id = b.id
       JOIN invoices i ON i.client_id = cl.id
       JOIN patient_owners po ON po.client_id = cl.id AND po.ownership_type = 'primary'
       WHERE b.organization_id = :orgId
         AND i.issued_date BETWEEN :from AND :to
         AND i.status != 'cancelled'
       GROUP BY cl.id ORDER BY total_spent DESC LIMIT 10`,
      { orgId, from, to }
    ),
  ]);

  // Totales consolidados
  const totals = revenue.reduce((acc, r) => ({
    invoices    : acc.invoices    + (r.invoices    || 0),
    gross       : acc.gross       + (r.gross_revenue || 0),
    collected   : acc.collected   + (r.collected   || 0),
    outstanding : acc.outstanding + (r.outstanding || 0),
  }), { invoices: 0, gross: 0, collected: 0, outstanding: 0 });

  return { totals, revenueByBranch: revenue, metricsByBranch: branches, topClients };
}

/**
 * Historial completo de un paciente a través de todas las sucursales del org.
 * @param {number} patientId
 * @param {number} orgId   — para seguridad: solo devuelve registros del org correcto
 */
async function crossBranchPatientHistory (patientId, orgId) {
  const [appointments, labs, vaccinations, prescriptions, transfers] = await Promise.all([
    db.query(
      `SELECT a.id, a.scheduled_date, a.status, a.reason,
              b.name AS branch_name, b.id AS branch_id,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name,
              at2.name AS appointment_type,
              mr.id AS record_id
       FROM appointments a
       JOIN branches b  ON a.branch_id = b.id AND b.organization_id = :orgId
       JOIN users    u  ON a.vet_id = u.id
       LEFT JOIN appointment_types at2 ON a.appointment_type_id = at2.id
       LEFT JOIN medical_records mr ON mr.appointment_id = a.id
       WHERE a.patient_id = :pid
       ORDER BY a.scheduled_date DESC LIMIT 100`,
      { pid: patientId, orgId }
    ),

    db.query(
      `SELECT lo.id, lo.ordered_at, lo.status,
              b.name AS branch_name, b.id AS branch_id,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM lab_orders lo
       JOIN branches b ON lo.branch_id = b.id AND b.organization_id = :orgId
       JOIN users    u ON lo.ordered_by = u.id
       WHERE lo.patient_id = :pid ORDER BY lo.ordered_at DESC LIMIT 50`,
      { pid: patientId, orgId }
    ),

    db.query(
      `SELECT v.id, v.vaccination_date, vc.name AS vaccine_name, v.batch_number, v.next_due_date,
              b.name AS branch_name, b.id AS branch_id,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM vaccinations v
       JOIN vaccines vc   ON vc.id = v.vaccine_id
       JOIN branches b    ON v.branch_id = b.id AND b.organization_id = :orgId
       JOIN users    u    ON v.administered_by = u.id
       WHERE v.patient_id = :pid ORDER BY v.vaccination_date DESC`,
      { pid: patientId, orgId }
    ),

    db.query(
      `SELECT pr.id, pr.created_at AS prescribed_at, pr.status,
              b.name AS branch_name, b.id AS branch_id,
              CONCAT(u.first_name,' ',u.last_name) AS vet_name
       FROM prescriptions pr
       JOIN medical_records mr ON mr.id = pr.medical_record_id
       JOIN appointments a     ON a.id = mr.appointment_id
       JOIN branches b         ON b.id = a.branch_id AND b.organization_id = :orgId
       JOIN users    u         ON pr.prescribed_by = u.id
       WHERE mr.patient_id = :pid ORDER BY pr.created_at DESC LIMIT 50`,
      { pid: patientId, orgId }
    ),

    db.query(
      `SELECT pt.*, bf.name AS from_branch, bt.name AS to_branch
       FROM patient_transfers pt
       JOIN branches bf ON pt.from_branch_id = bf.id AND bf.organization_id = :orgId
       JOIN branches bt ON pt.to_branch_id   = bt.id AND bt.organization_id = :orgId
       WHERE pt.patient_id = :pid ORDER BY pt.created_at DESC`,
      { pid: patientId, orgId }
    ),
  ]);

  return { appointments, labs, vaccinations, prescriptions, transfers };
}

module.exports = {
  assertSameOrg,
  assertBranchAccess,
  getOrgBranches,
  transferPatient,
  transferStock,
  consolidatedFinancials,
  crossBranchPatientHistory,
};
