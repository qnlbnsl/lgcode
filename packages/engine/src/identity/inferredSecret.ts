// Only values inferred from inherited variable names use this gate.
// Explicitly declared secrets bypass it, regardless of length or shape.
export const isInferredSecretValue = (value: string | undefined): value is string => {
  if (value === undefined || value.length < 8) return false;
  const trimmed = value.trim();
  return trimmed.length > 0
    && !/^(?:true|false)$/i.test(trimmed)
    && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed);
};
