const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function timestamp() {
  return new Date().toISOString();
}

function format(level, color, ...args) {
  const msg = args.map((a) => (typeof a === 'string' ? a : require('util').inspect(a))).join(' ');
  console.log(`${color}[${timestamp()}] [${level}]${colors.reset} ${msg}`);
}

module.exports = {
  info: (...args) => format('INFO', colors.cyan, ...args),
  success: (...args) => format('SUCCESS', colors.green, ...args),
  warn: (...args) => format('WARN', colors.yellow, ...args),
  error: (...args) => format('ERROR', colors.red, ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      format('DEBUG', colors.gray, ...args);
    }
  },
};
