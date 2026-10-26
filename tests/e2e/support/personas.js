// The three accounts the fake Keycloak knows — same subs as the recette, so its SQL
// snippets transfer verbatim. bob is the moderator through TOURNAMENT_MODERATORS (env.js).
export const PASSWORD = 'TestPassword1234'

export const PERSONAS = {
  alice: { sub: '11111111-1111-1111-1111-111111111111', username: 'alice', name: 'alice', email: 'alice@example.test', roles: [] },
  bob: { sub: '22222222-2222-2222-2222-222222222222', username: 'bob', name: 'bob', email: 'bob@example.test', roles: [] },
  carol: { sub: '33333333-3333-3333-3333-333333333333', username: 'carol@example.test', name: 'carol', email: 'carol@example.test', roles: [] },
}
