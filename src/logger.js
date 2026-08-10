function emit(level, msg, fields = {}) {
  const line = { level, msg, time: new Date().toISOString(), ...fields };
  const out = level === 'error' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}
export const logger = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
};
export default logger;
