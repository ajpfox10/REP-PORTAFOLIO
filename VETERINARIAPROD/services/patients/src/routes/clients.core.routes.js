'use strict';

const { Router } = require('express');
const { encrypt, decrypt, hashForSearch } = require('../../../../shared/encryption');
const {
  body,
  db,
  R,
  deletedPredicate,
  validate,
  logClientsError,
  getClientSchema,
  maskEmail,
  maskPhone,
  hasPiiAccess,
} = require('./clients.common');

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(parseInt(`${page}`, 10) || 1, 1);
    const parsedLimit = Math.min(parseInt(`${limit}`, 10) || 20, 100);
    const offset = (parsedPage - 1) * parsedLimit;
    const branchId = req.user.branchId;
    const schema = await getClientSchema();
    const clientCols = schema.clients || new Set();
    const ownerCols = schema.patient_owners || new Set();
    const activeExpr = clientCols.has('is_active') ? 'c.is_active' : (clientCols.has('active') ? 'c.active' : '1');
    const clientDeleted = deletedPredicate(clientCols, 'c');
    const ownerDeleted = deletedPredicate(ownerCols, 'po');

    const hasDocHash = clientCols.has('document_number_hash');
    let where = `WHERE c.branch_id = :branchId AND ${activeExpr} = TRUE AND ${clientDeleted}`;
    const params = { branchId, limit: parsedLimit, offset };
    const countParams = { branchId };
    if (search) {
      // document_number está cifrado en reposo: no se puede LIKE parcial, pero sí
      // buscar por coincidencia EXACTA vía blind index (HMAC) sin exponer el valor.
      const docClause = hasDocHash ? ' OR c.document_number_hash = :docHash' : '';
      where += ` AND (c.first_name LIKE :s OR c.last_name LIKE :s OR c.email LIKE :s OR c.phone LIKE :s${docClause})`;
      params.s = `%${search}%`;
      countParams.s = `%${search}%`;
      if (hasDocHash) {
        const docHash = hashForSearch(search);
        params.docHash = docHash;
        countParams.docHash = docHash;
      }
    }

    const [rows, [{ total }]] = await Promise.all([
      db.query(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                c.document_type, c.document_number,
                c.city, c.outstanding_balance, c.created_at,
                COUNT(DISTINCT po.patient_id) AS pet_count
         FROM clients c
         LEFT JOIN patient_owners po ON po.client_id = c.id
           AND po.ownership_type = 'primary'
           AND ${ownerDeleted}
           ${ownerCols.has('active') ? 'AND po.active = 1' : ''}
         ${where}
         GROUP BY c.id
         ORDER BY c.last_name, c.first_name
         LIMIT :limit OFFSET :offset`,
        params
      ),
      db.query(
        `SELECT COUNT(*) AS total
         FROM clients c
         ${where}`,
        countParams
      ),
    ]);

    // OT-098: mask PII for callers without 'clients:pii' permission
    // document_number cifrado en reposo: descifrar siempre (valores viejos en texto plano
    // se devuelven tal cual por compatibilidad), luego enmascarar si no hay acceso PII.
    const pii = hasPiiAccess(req);
    for (const row of rows) {
      if (row.document_number) row.document_number = decrypt(row.document_number);
      if (!pii) {
        row.email           = maskEmail(row.email);
        row.phone           = maskPhone(row.phone);
        row.document_number = row.document_number ? '****' : null;
      }
    }

    return R.paginated(res, rows, total, parsedPage, parsedLimit);
  } catch (e) {
    logClientsError('GET /clients', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, query: req.query });
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const schema = await getClientSchema();
    const patientCols = schema.patients || new Set();
    const clientCols = schema.clients || new Set();
    const ownerCols = schema.patient_owners || new Set();
    const contactCols = schema.client_emergency_contacts || new Set();
    const countryCols = schema.countries || new Set();
    const countryJoin = countryCols.has('code')
      ? 'c.country_code = co.code'
      : (countryCols.has('iso2') ? 'c.country_code = co.iso2' : (countryCols.has('iso3') ? 'c.country_code = co.iso3' : '1 = 0'));

    const client = await db.queryOne(
      `SELECT c.*,
              co.name AS country_name,
              cu.code AS currency_code
       FROM clients c
       LEFT JOIN countries co ON ${countryJoin}
       LEFT JOIN currencies cu ON c.currency_id = cu.id
       WHERE c.id = :id
         AND c.branch_id = :branchId
         AND ${deletedPredicate(clientCols, 'c')}
         ${clientCols.has('organization_id') ? 'AND c.organization_id = :orgId' : ''}`,
      { id: req.params.id, branchId: req.user.branchId, orgId: req.user.orgId }
    );
    if (!client) return R.notFound(res, 'Client not found');

    // document_number cifrado en reposo: descifrar siempre, luego enmascarar si corresponde.
    if (client.document_number) client.document_number = decrypt(client.document_number);
    // OT-098: mask PII fields unless caller has 'clients:pii' permission
    if (!hasPiiAccess(req)) {
      client.email           = maskEmail(client.email);
      client.phone           = maskPhone(client.phone);
      client.document_number = client.document_number ? '****' : null;
      client.tax_id          = client.tax_id          ? '****' : null;
    }

    const chipExpr = patientCols.has('chip_number')
      ? `COALESCE(p.chip_number, ${patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL'})`
      : (patientCols.has('microchip_number') ? 'p.microchip_number' : 'NULL');
    const birthExpr = patientCols.has('birthdate')
      ? `COALESCE(p.birthdate, ${patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL')})`
      : (patientCols.has('birth_date') ? 'p.birth_date' : (patientCols.has('date_of_birth') ? 'p.date_of_birth' : 'NULL'));
    const activeExpr = patientCols.has('is_active') ? 'p.is_active' : (patientCols.has('active') ? 'p.active' : '1');

    const [pets, contacts] = await Promise.all([
      db.query(
        `SELECT p.id, p.name, ${chipExpr} AS chip_number,
                sp.common_name AS species, b.name AS breed, p.sex, ${birthExpr} AS birthdate, ${activeExpr} AS is_active
         FROM patients p
         JOIN patient_owners po ON po.patient_id = p.id AND po.client_id = :cid AND ${deletedPredicate(ownerCols, 'po')}
         LEFT JOIN species sp ON p.species_id = sp.id
         LEFT JOIN breeds b ON p.breed_id = b.id
         WHERE ${deletedPredicate(patientCols, 'p')}
         ORDER BY p.name`,
        { cid: req.params.id }
      ),
      db.query(
        `SELECT name, relationship, phone, email, is_primary
         FROM client_emergency_contacts
         WHERE client_id = :cid
           ${contactCols.has('deleted_at') ? 'AND deleted_at IS NULL' : ''}
         ORDER BY is_primary DESC`,
        { cid: req.params.id }
      ),
    ]);

    return R.ok(res, { ...client, pets, emergencyContacts: contacts });
  } catch (e) {
    logClientsError('GET /clients/:id', e, { clientId: req.params.id, branchId: req.user?.branchId, orgId: req.user?.orgId });
    next(e);
  }
});

router.post('/',
  body('firstName').notEmpty().trim().isLength({ max: 100 }),
  body('lastName').notEmpty().trim().isLength({ max: 100 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').notEmpty().isLength({ max: 30 }),
  body('address').optional().isString().trim().isLength({ max: 500 }),
  body('city').optional().isString().trim().isLength({ max: 100 }),
  body('postalCode').optional().isString().trim().isLength({ max: 20 }),
  body('documentNumber').optional().isString().trim().isLength({ max: 50 }),
  body('taxId').optional().isString().trim().isLength({ max: 50 }),
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const {
        firstName, lastName, email, phone,
        documentType, documentNumber,
        address, city, stateId, countryCode, postalCode,
        currencyId, taxId, notes,
      } = req.body;
      const schema = await getClientSchema();
      const clientCols = schema.clients || new Set();

      let branchId = req.user.branchId || null;
      if (!branchId && req.user.orgId) {
        const br = await db.queryOne('SELECT id FROM branches WHERE organization_id = :orgId ORDER BY id LIMIT 1', { orgId: req.user.orgId });
        branchId = br?.id || null;
      }

      const columns = ['branch_id', 'first_name', 'last_name', 'phone'];
      const values = [':branchId', ':fn', ':ln', ':phone'];
      const params = {
        branchId,
        orgId: req.user.orgId,
        fn: firstName,
        ln: lastName,
        email: email || null,
        phone,
        docType: documentType || 'dni',
        docNum: documentNumber ? encrypt(documentNumber) : null,
        docNumHash: documentNumber ? hashForSearch(documentNumber) : null,   // blind index para búsqueda exacta
        addr: address || null,
        city: city || null,
        stateId: stateId || null,
        country: countryCode || null,
        postal: postalCode || null,
        curId: currencyId || null,
        taxId: taxId || null,
        notes: notes || null,
      };

      if (clientCols.has('organization_id')) { columns.push('organization_id'); values.push(':orgId'); }
      if (clientCols.has('email')) { columns.push('email'); values.push(':email'); }
      if (clientCols.has('document_type')) { columns.push('document_type'); values.push(':docType'); }
      if (clientCols.has('document_number')) { columns.push('document_number'); values.push(':docNum'); }
      if (clientCols.has('document_number_hash')) { columns.push('document_number_hash'); values.push(':docNumHash'); }
      if (clientCols.has('address')) { columns.push('address'); values.push(':addr'); }
      if (clientCols.has('city')) { columns.push('city'); values.push(':city'); }
      if (clientCols.has('state_id')) { columns.push('state_id'); values.push(':stateId'); }
      if (clientCols.has('country_code')) { columns.push('country_code'); values.push(':country'); }
      if (clientCols.has('postal_code')) { columns.push('postal_code'); values.push(':postal'); }
      if (clientCols.has('currency_id')) { columns.push('currency_id'); values.push(':curId'); }
      if (clientCols.has('tax_id')) { columns.push('tax_id'); values.push(':taxId'); }
      if (clientCols.has('notes')) { columns.push('notes'); values.push(':notes'); }
      if (clientCols.has('is_active')) { columns.push('is_active'); values.push('1'); }
      if (clientCols.has('active')) { columns.push('active'); values.push('1'); }

      const [result] = await db.query(
        `INSERT INTO clients (${columns.join(', ')})
         VALUES (${values.join(', ')})`,
        params
      );

      return R.created(res, { id: result.insertId });
    } catch (e) {
      logClientsError('POST /clients', e, { branchId: req.user?.branchId, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.put('/:id',
  body('firstName').optional().notEmpty().trim().isLength({ max: 100 }),
  body('lastName').optional().notEmpty().trim().isLength({ max: 100 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isString().isLength({ max: 30 }),
  body('address').optional().isString().trim().isLength({ max: 500 }),
  body('city').optional().isString().trim().isLength({ max: 100 }),
  body('postalCode').optional().isString().trim().isLength({ max: 20 }),
  body('documentNumber').optional().isString().trim().isLength({ max: 50 }),
  body('taxId').optional().isString().trim().isLength({ max: 50 }),
  body('notes').optional().isString().trim().isLength({ max: 2000 }),
  validate,
  async (req, res, next) => {
    try {
      const schema = await getClientSchema();
      const clientCols = schema.clients || new Set();
      const rawMap = {
        firstName: ['first_name'],
        lastName: ['last_name'],
        email: ['email'],
        phone: ['phone'],
        documentType: ['document_type'],
        documentNumber: ['document_number'],
        address: ['address'],
        city: ['city'],
        stateId: ['state_id'],
        countryCode: ['country_code'],
        postalCode: ['postal_code'],
        taxId: ['tax_id'],
        notes: ['notes'],
        isActive: ['is_active', 'active'],
      };

      const sets = [];
      const params = { id: req.params.id, branchId: req.user.branchId, orgId: req.user.orgId };
      for (const [key, value] of Object.entries(req.body)) {
        const targets = rawMap[key] || [];
        for (const column of targets) {
          if (!clientCols.has(column)) continue;
          const paramKey = `${column}_${sets.length}`;
          sets.push(`${column} = :${paramKey}`);
          if (column === 'is_active' || column === 'active') {
            params[paramKey] = ['1', 1, true, 'true'].includes(value) ? 1 : 0;
          } else if (column === 'document_number') {
            params[paramKey] = value ? encrypt(value) : value;   // cifrado en reposo
          } else {
            params[paramKey] = value;
          }
        }
      }
      // Mantener el blind index sincronizado cuando cambia el document_number.
      if ('documentNumber' in req.body && clientCols.has('document_number_hash')) {
        const v = req.body.documentNumber;
        const pk = `document_number_hash_${sets.length}`;
        sets.push(`document_number_hash = :${pk}`);
        params[pk] = v ? hashForSearch(v) : null;
      }
      if (!sets.length) return R.badRequest(res, 'No valid fields to update');

      await db.query(
        `UPDATE clients SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = :id
           AND branch_id = :branchId
           AND ${deletedPredicate(clientCols, 'clients')}
           ${clientCols.has('organization_id') ? 'AND organization_id = :orgId' : ''}`,
        params
      );
      return R.noContent(res);
    } catch (e) {
      logClientsError('PUT /clients/:id', e, { clientId: req.params.id, branchId: req.user?.branchId, orgId: req.user?.orgId, body: req.body });
      next(e);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const schema = await getClientSchema();
    const clientCols = schema.clients || new Set();
    const activeColumn = clientCols.has('is_active') ? 'is_active' : (clientCols.has('active') ? 'active' : null);
    if (!activeColumn) return R.badRequest(res, 'Client schema missing active column');
    const deletedSet = clientCols.has('deleted_at') ? ', deleted_at = NOW()' : '';

    await db.query(
      `UPDATE clients SET ${activeColumn} = FALSE${deletedSet}, updated_at = NOW()
       WHERE id = :id AND branch_id = :branchId
       AND ${deletedPredicate(clientCols, 'clients')}
       ${clientCols.has('organization_id') ? 'AND organization_id = :orgId' : ''}`,
      { id: req.params.id, branchId: req.user.branchId, orgId: req.user.orgId }
    );
    return R.noContent(res);
  } catch (e) {
    logClientsError('DELETE /clients/:id', e, { clientId: req.params.id, branchId: req.user?.branchId, orgId: req.user?.orgId });
    next(e);
  }
});

module.exports = router;
