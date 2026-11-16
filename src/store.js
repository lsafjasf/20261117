// store.js — tiny state container shared by the browser app and the tests.
// Rejects invalid candidates and always keeps the last valid state.

import { validateState, cloneState } from './scene.js';

export function createStore(initialState) {
  let current = cloneState(initialState);
  let lastErrors = [];
  return {
    getState: () => cloneState(current),
    getErrors: () => [...lastErrors],
    apply(candidate) {
      const result = validateState(candidate);
      if (!result.ok) {
        lastErrors = result.errors;
        return { ok: false, errors: result.errors };
      }
      current = cloneState(candidate);
      lastErrors = [];
      return { ok: true, errors: [] };
    },
  };
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`存档不是合法 JSON：${err.message}`], state: null };
  }
  const result = validateState(parsed);
  return { ok: result.ok, errors: result.errors, state: result.ok ? parsed : null };
}
