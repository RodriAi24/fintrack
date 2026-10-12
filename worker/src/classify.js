// Clasificación automática: tipo (gasto, ingreso, interno, reintegro), categoría y necesario/capricho.
// Orden: reglas de Rodrigo > reglas de fábrica > heurísticas. Lo que no se reconoce queda "para revisar".

export const CATEGORIES = {
  gasto: [
    { id: 'super', name: 'Súper', essential: true },
    { id: 'delivery', name: 'Delivery', essential: false },
    { id: 'salidas', name: 'Salidas', essential: false },
    { id: 'transporte', name: 'Transporte', essential: true },
    { id: 'servicios', name: 'Servicios', essential: true },
    { id: 'suscripciones', name: 'Suscripciones', essential: false },
    { id: 'hogar', name: 'Hogar', essential: true },
    { id: 'tarjeta', name: 'Tarjeta', essential: true },
    { id: 'salud', name: 'Salud', essential: true },
    { id: 'compras', name: 'Compras', essential: false },
    { id: 'ropa', name: 'Ropa', essential: false },
    { id: 'educacion', name: 'Educación', essential: true },
    { id: 'entretenimiento', name: 'Entretenimiento', essential: false },
    { id: 'impuestos', name: 'Impuestos', essential: true },
    { id: 'regalos', name: 'Regalos', essential: false },
    { id: 'transferencias', name: 'Transferencias', essential: true },
    { id: 'otros', name: 'Otros', essential: true },
  ],
  ingreso: [
    { id: 'sueldo', name: 'Sueldo' },
    { id: 'extra', name: 'Ingresos extra' },
    { id: 'rendimientos', name: 'Rendimientos' },
    { id: 'recibidas', name: 'Transferencias recibidas' },
    { id: 'otros_ingreso', name: 'Otros' },
  ],
};

const ESSENTIAL = Object.fromEntries(CATEGORIES.gasto.map(c => [c.id, c.essential]));

// Palabras clave de comercios comunes en Argentina → categoría
const BUILTIN = [
  ['delivery', ['pedidosya', 'pedidos ya', 'rappi', 'uber eats', 'didi food', 'glovo']],
  ['transporte', ['uber', 'cabify', 'didi', 'sube', 'ypf', 'shell', 'axion', 'puma energy', 'peaje', 'autopista', 'estacionamiento', 'trenes argentinos', 'subte', 'emova']],
  ['super', ['carrefour', 'coto', 'jumbo', 'disco', 'vea ', 'supermercado', 'super mercado', 'dia argentina', 'changomas', 'la anonima', 'walmart', 'market', 'autoservicio', 'almacen', 'verduleria', 'carniceria', 'kiosco', 'maxikiosco']],
  ['salidas', ['hormiga negra', 'bar ', 'cerveceria', 'restaurant', 'resto ', 'parrilla', 'pizzeria', 'cafe', 'starbucks', 'havanna', 'mostaza', 'mcdonald', 'burger king', 'boliche', 'cine', 'teatro', 'ticketek', 'passline', 'eventbrite']],
  ['servicios', ['edenor', 'edesur', 'metrogas', 'naturgy', 'aysa', 'personal', 'movistar', 'claro', 'telecentro', 'fibertel', 'flow', 'directv', 'telefonica']],
  ['suscripciones', ['netflix', 'spotify', 'disney', 'hbo', 'youtube', 'apple.com', 'icloud', 'google', 'chatgpt', 'openai', 'anthropic', 'claude.ai', 'amazon prime', 'prime video', 'paramount', 'crunchyroll', 'canva', 'notion', 'dropbox']],
  ['salud', ['farmacity', 'farmacia', 'osde', 'swiss medical', 'swissmedical', 'medife', 'sancor salud', 'hospital italiano', 'galeno', 'medicus', 'omint', 'hospital', 'clinica', 'odontolog', 'smart fit', 'megatlon', 'gimnasio', 'sport club']],
  ['hogar', ['alquiler', 'expensas', 'easy', 'sodimac', 'ikea', 'ferreteria', 'pintureria']],
  ['compras', ['mercadolibre', 'mercado libre', 'amazon', 'aliexpress', 'shein', 'temu', 'fravega', 'garbarino', 'musimundo', 'tiendamia']],
  ['ropa', ['zara', 'nike', 'adidas', 'h&m', 'kevingston', 'levis', 'dexter', 'grimoldi', 'stock center']],
  ['educacion', ['udemy', 'coursera', 'platzi', 'domestika', 'universidad', 'colegio', 'libreria']],
  ['entretenimiento', ['steam', 'playstation', 'xbox', 'nintendo', 'epic games', 'twitch']],
  ['impuestos', ['afip', 'arca', 'monotributo', 'arba', 'agip', 'rentas']],
];

export function normalizeText(...parts) {
  return ' ' + parts.filter(Boolean).join(' ')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(payu|merpago|mercpago|mp)\*(ar\*)?/g, ' ')
    .replace(/[*_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' ';
}

// Clave para aprender de una corrección: la contraparte o la descripción, sin números
export function merchantKey(m) {
  const base = normalizeText(m.counterparty || m.description || '').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.split(' ').slice(0, 3).join(' ');
}

// La regla matchea si su patrón aparece al principio de alguna palabra del texto
function matchRule(rules, text) {
  return rules.find(r => {
    const p = normalizeText(r.pattern || '').trim();
    return p && text.includes(` ${p}`);
  });
}

// m: movimiento crudo. ctx: { rules, myName }
// Devuelve { kind, category, essential, review, category_source }
export function classify(m, ctx = {}) {
  const text = normalizeText(m.description, m.counterparty);
  const myName = normalizeText(ctx.myName || '');
  const isSelf = ctx.myName && m.counterparty && normalizeText(m.counterparty) === myName;

  if (m.status && ['cancelled', 'rejected', 'pending', 'in_process', 'authorized'].includes(m.status)) {
    return { kind: 'descartado', category: null, essential: null, review: 0, category_source: 'auto' };
  }

  // Entre cuentas propias (vos pagás y vos cobrás) o un pago que no es tuyo: nunca suma
  if (m.direction === 'interno') return { kind: 'interno', category: null, essential: null, review: 0, category_source: 'auto' };
  if (m.direction === 'ajeno') return { kind: 'descartado', category: null, essential: null, review: 0, category_source: 'auto' };

  // Reglas de Rodrigo primero (pueden cambiar hasta el tipo)
  const rule = matchRule(ctx.rules || [], text);
  if (rule) {
    const kind = rule.kind || (m.amount < 0 ? 'gasto' : 'ingreso');
    return {
      kind, category: rule.category,
      essential: rule.essential ?? (kind === 'gasto' ? ESSENTIAL[rule.category] ?? true : null),
      review: 0, category_source: 'regla',
    };
  }

  if (m.kind_hint === 'rendimiento') return { kind: 'ingreso', category: 'rendimientos', essential: null, review: 0, category_source: 'auto' };
  if (m.kind_hint === 'reintegro') return { kind: 'reintegro', category: null, essential: null, review: 0, category_source: 'auto' };

  // DEBIN entrante: plata propia que viene del banco (el sueldo pasando a MP)
  if (m.amount > 0 && (m.method === 'debin_transfer' || m.method === 'debin')) {
    return { kind: 'interno', category: null, essential: null, review: 0, category_source: 'auto' };
  }
  // Transferencias entre cuentas propias
  if (isSelf && m.direction !== 'sale') return { kind: 'interno', category: null, essential: null, review: 0, category_source: 'auto' };

  if (m.amount >= 0) {
    if (m.op === 'money_transfer' || m.mp_type === 'bank_transfer') {
      return { kind: 'ingreso', category: 'recibidas', essential: null, review: 1, category_source: 'auto' };
    }
    return { kind: 'ingreso', category: 'otros_ingreso', essential: null, review: 1, category_source: 'auto' };
  }

  // Gasto: comercios conocidos
  for (const [cat, words] of BUILTIN) {
    if (words.some(w => text.includes(` ${w}`))) {
      return { kind: 'gasto', category: cat, essential: ESSENTIAL[cat], review: 0, category_source: 'fabrica' };
    }
  }
  // Compra con título de producto (Mercado Libre y similares)
  if (m.op === 'regular_payment' && (m.description || '').length > 28) {
    return { kind: 'gasto', category: 'compras', essential: false, review: 0, category_source: 'fabrica' };
  }
  if (m.op === 'money_transfer' || m.kind_hint === 'payout') {
    return { kind: 'gasto', category: 'transferencias', essential: true, review: 1, category_source: 'auto' };
  }
  return { kind: 'gasto', category: 'otros', essential: true, review: 1, category_source: 'auto' };
}
