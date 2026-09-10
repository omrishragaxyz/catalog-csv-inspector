// Bounded example: native product CSV fields, new draft products, supplied identifiers.
// This is local structural validation, not a Shopify import simulator.
export const headers = ['Handle','Title','Vendor','Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value','Variant SKU','Variant Price','Variant Inventory Policy','Variant Fulfillment Service','Variant Requires Shipping','Variant Taxable','Published','Status'];
const optionKeys = ['Option1 Name','Option1 Value','Option2 Name','Option2 Value','Option3 Name','Option3 Value'];
export function normalizeCatalog(rawRows) {
  const kept = [], duplicates = [], changes = [], seen = new Map();
  rawRows.forEach((raw, i) => {
    if (headers.some(h => typeof raw[h] !== 'string')) throw new Error(`Source row ${i+2}: every expected field must be present as text`);
    if (Object.keys(raw).some(h => !headers.includes(h))) throw new Error('Unmapped source column; agree mapping before continuing');
    // CSV quoting does not prevent spreadsheet formula execution when reviewed in Excel.
    // Reject before writing any delivery, including the raw-source copy and exception file.
    // A legitimately prefixed identifier needs a separately agreed review format; never alter it.
    for(const h of headers) if(/^[=+@-]/.test(raw[h].replace(/^[\s\u0000-\u0020]+/,''))) throw new Error(`Formula-like value requires review in source row ${i+2}, column ${h}`);
    const signature = JSON.stringify(headers.map(h=>raw[h]));
    if (seen.has(signature)) { duplicates.push({sourceRow:i+2,keptRow:seen.get(signature)}); return; }
    seen.set(signature,i+2);
    const row={...raw}, reasons=[];
    const title=row.Title.trim();
    if(title!==row.Title) { changes.push({sourceRow:i+2,field:'Title',before:row.Title,after:title,reason:'Trim surrounding title whitespace'}); row.Title=title; }
    const price=row['Variant Price'].trim();
    if (!/^\$?\d+(?:\.\d{1,2})?$/.test(price)) reasons.push(price ? 'Ambiguous or invalid USD price' : 'Missing unit price');
    else {
      const clean=price.replace(/^\$/,'');
      const [whole,fraction='']=clean.split('.');
      const fixed=`${whole}.${fraction.padEnd(2,'0')}`;
      if(fixed!==row['Variant Price']) { changes.push({sourceRow:i+2,field:'Variant Price',before:row['Variant Price'],after:fixed,reason:'Normalize confirmed USD price notation'}); row['Variant Price']=fixed; }
    }
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.Handle)) reasons.push('Missing or invalid supplied handle');
    if(!row['Variant SKU']) reasons.push('Missing supplied SKU');
    if(!row['Option1 Name'] || !row['Option1 Value']) reasons.push('Missing supplied option 1 identity');
    for(const n of [2,3]) if(Boolean(row[`Option${n} Name`])!==Boolean(row[`Option${n} Value`])) reasons.push(`Incomplete option ${n}`);
    if(row['Option3 Name']&&!row['Option2 Name']) reasons.push('Option 3 requires option 2');
    if(row.Status!=='draft'||row.Published!=='FALSE') reasons.push('Sample scope accepts only explicitly supplied draft/unpublished products');
    if(!['deny','continue'].includes(row['Variant Inventory Policy'])) reasons.push('Invalid inventory policy');
    if(row['Variant Fulfillment Service']!=='manual') reasons.push('Fulfillment service outside sample scope');
    for(const field of ['Variant Requires Shipping','Variant Taxable']) if(!['TRUE','FALSE'].includes(row[field])) reasons.push(`Invalid ${field}`);
    kept.push({sourceRow:i+2,raw,row,reasons});
  });
  const skuGroups=new Map(), handleGroups=new Map();
  for(const item of kept) {
    const sku=item.row['Variant SKU'];
    if(sku) { if(!skuGroups.has(sku)) skuGroups.set(sku,[]); skuGroups.get(sku).push(item); }
    if(item.row.Handle) { if(!handleGroups.has(item.row.Handle)) handleGroups.set(item.row.Handle,[]); handleGroups.get(item.row.Handle).push(item); }
  }
  for(const group of skuGroups.values()) if(group.length>1) for(const item of group) item.reasons.push('Conflicting non-identical rows share one SKU');
  for(const group of handleGroups.values()) {
    const variants=new Map();
    const titles=new Set(group.map(i=>i.row.Title).filter(Boolean));
    if(!group[0].row.Title) for(const item of group) item.reasons.push('First product row lacks a supplied title');
    if(titles.size>1) for(const item of group) item.reasons.push('Conflicting titles share one product handle');
    const schemas=new Set(group.map(i=>JSON.stringify([1,2,3].map(n=>i.row[`Option${n} Name`]))));
    if(schemas.size>1) for(const item of group) item.reasons.push('Inconsistent option names within product');
    for(const item of group) {
      const identity=JSON.stringify(optionKeys.map(k=>item.row[k]));
      if(!variants.has(identity)) variants.set(identity,[]);
      variants.get(identity).push(item);
    }
    for(const collision of variants.values()) if(collision.length>1) for(const item of collision) item.reasons.push('Duplicate variant option combination');
    if(group.some(i=>i.reasons.length)) for(const item of group) if(!item.reasons.length) item.reasons.push('Another row in this product needs a decision; entire product held');
  }
  const ready=kept.filter(i=>!i.reasons.length), held=kept.filter(i=>i.reasons.length);
  // Group complete products without rewriting supplied handles or option identities.
  const readyHandles=[...new Set(ready.map(i=>i.row.Handle))];
  const ordered=readyHandles.flatMap(h=>ready.filter(i=>i.row.Handle===h));
  return {ready:ordered,held,duplicates,changes,sourceCount:rawRows.length};
}
export function csvText(fields, rows) {
  const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return [fields,...rows.map(r=>fields.map(h=>r[h]))].map(row=>row.map(quote).join(',')).join('\n')+'\n';
}
