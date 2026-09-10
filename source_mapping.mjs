import {headers} from './catalog_transform.mjs';
import {recordsToObjects} from './csv_io.mjs';

const operationalConstants = {
  Status: ['draft'], Published: ['FALSE'],
  'Variant Fulfillment Service': ['manual'],
  'Variant Inventory Policy': ['deny', 'continue'],
};
const optionalBlanks = new Set(['Vendor','Option2 Name','Option2 Value','Option3 Name','Option3 Value']);
const formulaLike = value => /^[=+@-]/.test(value.replace(/^[\s\u0000-\u0020]+/,''));

// An explicit agreement maps names, not guesses: identifiers, prices, shipping and
// tax flags must come from the source. Source-only columns remain in the original.
export function mapSourceRecords(records, mapping) {
  if (!records.length) throw new Error('Empty input file');
  if (mapping.schemaVersion !== 1 || !Array.isArray(mapping.fields)) throw new Error('Mapping requires schemaVersion 1 and a fields array');
  if (!['agreed','synthetic'].includes(mapping.status) || typeof mapping.agreementReference !== 'string' || !mapping.agreementReference.trim()) throw new Error('Record an agreed mapping reference, or label a synthetic rehearsal explicitly');
  if (mapping.currency !== 'USD') throw new Error('Mapping must explicitly confirm USD; no currency conversion is performed');
  const sourceHeaders = records[0];
  if (sourceHeaders.some(h => !h.trim())) throw new Error('Source columns must have nonempty names');
  const sourceRows = recordsToObjects(records, sourceHeaders);
  // Even retained-only cells and column names are copied into the delivery archive.
  // Reject unsafe spreadsheet cells before any outputs, rather than hiding them.
  for (const [i, row] of records.entries()) for (const cell of row) if (formulaLike(cell)) throw new Error(`Formula-like value requires review in source record ${i+1}`);
  const targets = new Set(), consumed = new Set(), mappingRows = [];
  for (const field of mapping.fields) {
    if (!headers.includes(field.target) || targets.has(field.target)) throw new Error(`Unknown or duplicate mapping target: ${field.target}`);
    targets.add(field.target);
    const hasSource = Object.hasOwn(field, 'source'), hasConstant = Object.hasOwn(field, 'constant');
    if (hasSource === hasConstant) throw new Error(`Map ${field.target} from one source or one explicit constant`);
    if (hasSource) {
      if (!sourceHeaders.includes(field.source) || consumed.has(field.source)) throw new Error(`Unknown or multiply mapped source column: ${field.source}`);
      consumed.add(field.source);
      mappingRows.push({Disposition:'Mapped', 'Source column':field.source, 'Destination column':field.target, 'Constant value':'', Reason:'Exact supplied field value; no inference'});
    } else {
      if (typeof field.constant !== 'string' || !((optionalBlanks.has(field.target) && field.constant === '') || operationalConstants[field.target]?.includes(field.constant))) throw new Error(`Unsupported constant for ${field.target}; product facts must come from the source`);
      mappingRows.push({Disposition:'Explicit constant', 'Source column':'', 'Destination column':field.target, 'Constant value':field.constant, Reason:'Explicitly recorded operational setting or optional blank'});
    }
  }
  if (headers.some(h => !targets.has(h))) throw new Error(`Unmapped destination columns: ${headers.filter(h => !targets.has(h)).join(', ')}`);
  const retained = new Set();
  for (const field of mapping.retainOnly ?? []) {
    if (!sourceHeaders.includes(field.source) || consumed.has(field.source) || retained.has(field.source)) throw new Error(`Invalid or colliding retained-only source: ${field.source}`);
    if (typeof field.reason !== 'string' || !field.reason.trim() || formulaLike(field.reason)) throw new Error('Each retained-only source column needs a safe, explicit reason');
    retained.add(field.source);
    mappingRows.push({Disposition:'Retained in original only', 'Source column':field.source, 'Destination column':'', 'Constant value':'', Reason:field.reason});
  }
  const unaccounted = sourceHeaders.filter(h => !consumed.has(h) && !retained.has(h));
  if (unaccounted.length) throw new Error(`Source columns need mapping or an explicit retain-only decision: ${unaccounted.join(', ')}`);
  const nativeRows = sourceRows.map(source => Object.fromEntries(mapping.fields.map(field => [field.target, Object.hasOwn(field,'source') ? source[field.source] : field.constant])));
  return {nativeRows, sourceHeaders, mappingRows};
}
