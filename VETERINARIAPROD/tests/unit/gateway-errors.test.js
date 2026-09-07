'use strict';

const express = require('express');
const request = require('supertest');
const { registerNotFoundHandler, registerErrorHandlers } = require('../../gateway/src/bootstrap/errors');

describe('gateway error envelopes', () => {
  test('404 responses include request and trace ids', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.requestId = 'req-404';
      req.traceId = 'trace-404';
      next();
    });
    registerNotFoundHandler(app);

    const res = await request(app).get('/missing');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        path: '/missing',
        method: 'GET',
        requestId: 'req-404',
        traceId: 'trace-404',
      },
    });
  });

  test('500 responses include request and trace ids', async () => {
    const app = express();
    app.get('/boom', (req, _res, next) => {
      req.requestId = 'req-500';
      req.traceId = 'trace-500';
      next(new Error('boom'));
    });
    registerErrorHandlers(app);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId: 'req-500',
        traceId: 'trace-500',
      },
    });
  });
});
