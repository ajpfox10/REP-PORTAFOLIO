const auditModel = require('../models/audit.model');

async function list(req, res, next) {
  try {
    const filters = {
      user_id:  req.query.user_id,
      action:   req.query.action,
      dateFrom: req.query.dateFrom,
      dateTo:   req.query.dateTo,
    };
    const result = await auditModel.findAll(filters, { page: req.query.page, limit: req.query.limit });
    res.json(result);
  } catch (err) { next(err); }
}

async function byIncident(req, res, next) {
  try {
    const entries = await auditModel.findByEntity('incidents', req.params.uuid);
    res.json(entries);
  } catch (err) { next(err); }
}

module.exports = { list, byIncident };
