// Shared response shaping for life_spaces rows, so every route that returns
// one does it the same way instead of re-implementing the redaction.
// Never send the passcode hash to the client; expose only whether one is set.
function sanitizeLifeSpace(lifeSpace, role) {
  const { passcode_hash, ...rest } = lifeSpace;
  const out = { ...rest, hasPasscode: !!passcode_hash };
  if (role) out.role = role;
  return out;
}

module.exports = { sanitizeLifeSpace };
