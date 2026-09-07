'use strict';

const {
  parseTraceparent,
  buildTraceparent,
  createTraceContext,
  buildOutgoingTraceHeaders,
} = require('../../shared/tracing');

describe('tracing helpers', () => {
  test('parses valid traceparent', () => {
    const parsed = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    expect(parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed.parentSpanId).toBe('00f067aa0ba902b7');
  });

  test('builds traceparent', () => {
    expect(buildTraceparent({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      flags: '01',
    })).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });

  test('creates context from existing traceparent', () => {
    const context = createTraceContext({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(context.parentSpanId).toBe('00f067aa0ba902b7');
    expect(context.spanId).toHaveLength(16);
  });

  test('builds outgoing headers', () => {
    const headers = buildOutgoingTraceHeaders({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' });
    expect(headers['X-Trace-Id']).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(headers['X-Parent-Span-Id']).toBe('00f067aa0ba902b7');
    expect(headers['X-Span-Id']).toHaveLength(16);
    expect(headers.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
  });
});
