'use strict';

const { AUTH_PUBLIC } = require('../../gateway/src/routes/registries/auth.registry');

describe('gateway auth public routes', () => {
  test('allows the pending-token 2FA challenge without an access token', () => {
    expect(AUTH_PUBLIC).toContain('/2fa/challenge');
  });

  test('does not advertise an unimplemented register route', () => {
    expect(AUTH_PUBLIC).not.toContain('/register');
  });
});
