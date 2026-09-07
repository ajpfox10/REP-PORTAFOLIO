'use strict';

const { templates } = require('../../shared/messaging');

describe('Messaging templates', () => {

  test('appointmentReminder contiene datos del paciente', () => {
    const msg = templates.appointmentReminder({
      ownerName: 'Carlos', petName: 'Firulais',
      date: '25/03/2026', time: '10:00',
      vetName: 'Dra. García', clinicName: 'VetClinic',
    });
    expect(msg).toContain('Carlos');
    expect(msg).toContain('Firulais');
    expect(msg).toContain('25/03/2026');
    expect(msg).toContain('10:00');
    expect(msg).toContain('VetClinic');
  });

  test('appointmentConfirm contiene confirmación', () => {
    const msg = templates.appointmentConfirm({
      ownerName: 'Ana', petName: 'Luna',
      date: '26/03/2026', time: '15:30', clinicName: 'PetCare',
    });
    expect(msg).toContain('Ana');
    expect(msg).toContain('Luna');
    expect(msg).toContain('confirmada');
  });

  test('vaccinationReminder contiene vacuna y fecha', () => {
    const msg = templates.vaccinationReminder({
      ownerName: 'Pedro', petName: 'Rex',
      vaccineName: 'Antirrábica', dueDate: '01/04/2026', clinicName: 'VetMax',
    });
    expect(msg).toContain('Antirrábica');
    expect(msg).toContain('01/04/2026');
    expect(msg).toContain('Rex');
  });

  test('paymentConfirmed contiene monto y número de factura', () => {
    const msg = templates.paymentConfirmed({
      ownerName: 'María', amount: '5000.00',
      invoiceNumber: 'F-001', clinicName: 'VetPro',
    });
    expect(msg).toContain('5000.00');
    expect(msg).toContain('F-001');
    expect(msg).toContain('confirmado');
  });

  test('labReady contiene nombre del estudio', () => {
    const msg = templates.labReady({
      ownerName: 'José', petName: 'Michi',
      testName: 'Hemograma', clinicName: 'VetLab',
    });
    expect(msg).toContain('Hemograma');
    expect(msg).toContain('Michi');
  });

  test('labCritical contiene alerta', () => {
    const msg = templates.labCritical({
      vetName: 'Dr. López', patientName: 'Bobby', testName: 'Glucosa',
    });
    expect(msg).toContain('ALERTA');
    expect(msg).toContain('Glucosa');
    expect(msg).toContain('Bobby');
  });

  test('dischargeReady contiene alta', () => {
    const msg = templates.dischargeReady({
      ownerName: 'Laura', petName: 'Nala', clinicName: 'AnimalCare',
    });
    expect(msg).toContain('Nala');
    expect(msg).toContain('retirado');
  });
});
