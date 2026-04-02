const incidentModel = require('../models/incident.model');

async function list(req, res, next) {
  try {
    const filters = {
      status:           req.query.status,
      priority:         req.query.priority,
      incident_type_id: req.query.incident_type_id,
      province_id:      req.query.province_id,
      partido_id:       req.query.partido_id,
      locality_id:      req.query.locality_id,
      dateFrom:         req.query.dateFrom,
      dateTo:           req.query.dateTo,
      search:           req.query.search,
    };
    if (req.user.role === 'medium') {
      filters.reported_by_user_id = req.user.id;
    }
    const result = await incidentModel.findAll(filters, { page: req.query.page, limit: req.query.limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function mapPoints(req, res, next) {
  try {
    const filters = {
      status:           req.query.status,
      incident_type_id: req.query.incident_type_id,
      province_id:      req.query.province_id,
    };
    const points = await incidentModel.findMapPoints(filters);
    res.json(points);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const incident = await incidentModel.findByUuid(req.params.uuid);
    if (!incident) return res.status(404).json({ error: 'Incidente no encontrado' });
    res.json(incident);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    req.auditOld = null;
    const incident = await incidentModel.create(req.body, req.user.id);
    req.auditNew = { uuid: incident.uuid, incident_number: incident.incident_number, status: incident.status };
    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const old = await incidentModel.findByUuid(req.params.uuid);
    if (!old) return res.status(404).json({ error: 'Incidente no encontrado' });

    req.auditOld = { status: old.status, priority: old.priority };

    const incident = await incidentModel.update(req.params.uuid, req.body, req.user.id, req.user.role);
    req.auditNew = { status: incident.status, priority: incident.priority };

    res.json(incident);
  } catch (err) {
    next(err);
  }
}

async function softDelete(req, res, next) {
  try {
    const deleted = await incidentModel.softDelete(req.params.uuid, req.user.id, req.user.role);
    if (!deleted) return res.status(404).json({ error: 'Incidente no encontrado' });
    res.json({ message: 'Incidente eliminado exitosamente' });
  } catch (err) {
    next(err);
  }
}

async function addUnit(req, res, next) {
  try {
    const unit = await incidentModel.addUnit(req.params.uuid, req.body);
    if (!unit) return res.status(404).json({ error: 'Incidente no encontrado' });
    res.status(201).json(unit);
  } catch (err) {
    next(err);
  }
}

async function removeUnit(req, res, next) {
  try {
    const deleted = await incidentModel.removeUnit(req.params.uuid, req.params.unitId);
    if (!deleted) return res.status(404).json({ error: 'Unidad no encontrada' });
    res.json({ message: 'Unidad removida exitosamente' });
  } catch (err) {
    next(err);
  }
}

async function addResource(req, res, next) {
  try {
    const resource = await incidentModel.addResource(req.params.uuid, req.body);
    if (!resource) return res.status(404).json({ error: 'Incidente no encontrado' });
    res.status(201).json(resource);
  } catch (err) {
    next(err);
  }
}

async function removeResource(req, res, next) {
  try {
    const deleted = await incidentModel.removeResource(req.params.uuid, req.params.resourceId);
    if (!deleted) return res.status(404).json({ error: 'Recurso no encontrado' });
    res.json({ message: 'Recurso removido exitosamente' });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const old = await incidentModel.findByUuid(req.params.uuid);
    if (!old) return res.status(404).json({ error: 'Incidente no encontrado' });

    req.auditOld = { status: old.status };

    const incident = await incidentModel.updateStatus(
      req.params.uuid, req.body.status, req.user.id, req.body.notes
    );
    req.auditNew = { status: incident.status };

    res.json(incident);
  } catch (err) {
    next(err);
  }
}

async function getStatusHistory(req, res, next) {
  try {
    const history = await incidentModel.getStatusHistory(req.params.uuid);
    if (!history) return res.status(404).json({ error: 'Incidente no encontrado' });
    res.json(history);
  } catch (err) {
    next(err);
  }
}

async function dashboard(req, res, next) {
  try {
    const stats = await incidentModel.getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list, mapPoints, getOne, create, update, softDelete,
  addUnit, removeUnit, addResource, removeResource,
  updateStatus, getStatusHistory, dashboard,
};
