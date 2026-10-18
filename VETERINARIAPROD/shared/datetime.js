'use strict';

// MySQL DATETIME no acepta el sufijo de zona horaria de ISO 8601 ("Z", "-03:00").
// Con zona se convierte a UTC (el pool usa timezone 'Z'); sin zona es la hora
// local que eligió la persona en el formulario y se respeta tal cual.
function toMySqlDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  const text = String(value).trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 19).replace('T', ' ');
  }
  return text.replace('T', ' ').slice(0, 19);
}

module.exports = { toMySqlDateTime };
