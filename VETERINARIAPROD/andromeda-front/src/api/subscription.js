import http from './client'

export const subscriptionApi = {
  get:      ()     => http.get('/subscription'),
  checkout: (plan) => http.post('/subscription/checkout', { plan }),
  cancel:   ()     => http.post('/subscription/cancel', {}),
}

export default subscriptionApi
