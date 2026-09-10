import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {headers,normalizeCatalog,csvText} from './catalog_transform.mjs';
import {parseCsv,recordsToObjects} from './csv_io.mjs';
import {mapSourceRecords} from './source_mapping.mjs';

function options(args) {
  if(args.includes('--help'))return null;
  const found={};
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--input','--out-dir','--mapping'].includes(key)||!value||value.startsWith('--')||found[key])throw new Error('Use --input FILE --out-dir NEW_DIRECTORY [--mapping AGREED_MAPPING.json]');found[key]=value;}
  if(!found['--input']||!found['--out-dir'])throw new Error('Use --input FILE --out-dir NEW_DIRECTORY');
  return {input:path.resolve(found['--input']),out:path.resolve(found['--out-dir']),mapping:found['--mapping'] ? path.resolve(found['--mapping']) : null};
}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
 const opts=options(process.argv.slice(2));
 if(!opts){console.log('Usage: node prepare_catalog.mjs --input FILE --out-dir NEW_DIRECTORY [--mapping AGREED_MAPPING.json]\nAccepts native columns or explicit supplier header mapping. Requires agreed USD unit prices and new draft/unpublished products only. At most 250 source records. Output directory must not already exist. No network, Shopify, Artifact Tool or workbook renderer is used.');return;}
 const input=await fs.readFile(opts.input);
 if(input.length>10*1024*1024)throw new Error('Input exceeds 10 MiB sample delivery limit');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(input);
 const records=parseCsv(text);
 const mappingBytes=opts.mapping ? await fs.readFile(opts.mapping) : null;
 const mapping=mappingBytes ? JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(mappingBytes)) : null;
 const mapped=mapping ? mapSourceRecords(records,mapping) : null;
 const rows=mapped ? mapped.nativeRows : recordsToObjects(records,headers);
 if(rows.length<1||rows.length>250)throw new Error('Accepted source size is 1–250 product records');
 const result=normalizeCatalog(rows);
 assert.equal(result.sourceCount,result.ready.length+result.held.length+result.duplicates.length);
 const partition=[...result.ready.map(i=>i.sourceRow),...result.held.map(i=>i.sourceRow),...result.duplicates.map(i=>i.sourceRow)].sort((a,b)=>a-b);
 assert.deepEqual(partition,rows.map((_,i)=>i+2),'Each source record must be accounted for exactly once');
 const immutable=headers.filter(h=>!['Title','Variant Price'].includes(h));
 for(const item of result.ready)for(const h of immutable)assert.equal(item.row[h],item.raw[h],`Unexpected change to ${h}`);
 const readyHandles=new Set(result.ready.map(i=>i.row.Handle));
 assert.equal(result.held.some(i=>readyHandles.has(i.row.Handle)),false,'Partial products must not be released');
 const files={
  [mapped ? 'input-original.csv' : 'source-feed.csv']:input,
  'shopify-draft-products.csv':csvText(headers,result.ready.map(i=>i.row)),
  'exceptions.csv':csvText(['Source row','Handle','SKU','Original price','Reason','Customer decision'],result.held.map(i=>({'Source row':i.sourceRow,Handle:i.raw.Handle,SKU:i.raw['Variant SKU'],'Original price':i.raw['Variant Price'],Reason:[...new Set(i.reasons)].join('; '),'Customer decision':''}))),
  'change-log.csv':csvText(['Source row','Field','Before','After','Reason'],result.changes.map(c=>({'Source row':c.sourceRow,Field:c.field,Before:c.before,After:c.after,Reason:c.reason}))),
  'duplicates.csv':csvText(['Source row','Kept source row'],result.duplicates.map(d=>({'Source row':d.sourceRow,'Kept source row':d.keptRow}))),
 };
 if(mapped){
  files['field-mapping.csv']=csvText(['Disposition','Source column','Destination column','Constant value','Reason'],mapped.mappingRows);
  files['mapping.json']=mappingBytes;
  files['README.md']=`# Product file preparation\n\n${mapping.status==='synthetic'?'Synthetic rehearsal. No customer order or approval is represented.\n\n':''}${rows.length} original records: ${result.ready.length} prepared, ${result.held.length} held for a decision, ${result.duplicates.length} duplicate mapped records.\n\nStart with field-mapping.csv to review the source columns, explicit operational settings, and source-only fields. input-original.csv contains the complete, unchanged input. mapping.json records the mapping reference.\n\nshopify-draft-products.csv contains only complete product groups that passed local checks. Review exceptions.csv for missing or conflicting facts, change-log.csv for proposed title/price normalizations, and duplicates.csv for repeated mapped records. Retained-only source fields do not participate in duplicate comparison and remain in the original file.\n\nScope: new draft/unpublished products, supplied USD prices, manual fulfillment. This package has not been imported into Shopify. Resolve the listed decisions and review the agreed destination schema before any store import.\n`;
 }
 const roundtrip=recordsToObjects(parseCsv(files['shopify-draft-products.csv']),headers);
 assert.deepEqual(roundtrip,result.ready.map(i=>i.row),'Output serialization must preserve every value');
 // New output directory prevents stale success manifests or overwriting earlier deliveries.
 await fs.mkdir(opts.out);
 try {
  for(const [name,content]of Object.entries(files))await fs.writeFile(path.join(opts.out,name),content,{flag:'wx'});
  const hashes={};
  for(const [name,content]of Object.entries(files)){const actual=await fs.readFile(path.join(opts.out,name));assert.equal(sha(actual),sha(content));hashes[name]=sha(actual);}
  const manifest={schemaVersion:1,executionStatus:'complete',deliveryStatus:result.held.length?'prepared_with_exceptions':'prepared_for_review',liveImportVerified:false,scope:'Local file preparation; agreed USD native product schema; new draft products only',sourceRows:rows.length,preparedRows:result.ready.length,heldRows:result.held.length,duplicateRows:result.duplicates.length,preparedProducts:readyHandles.size,changedCells:result.changes.length,readySourceRows:result.ready.map(i=>i.sourceRow),heldSourceRows:result.held.map(i=>i.sourceRow),customerDecisionsRequired:result.held.length>0,hashes};
  if(mapped){manifest.sourceMapping={status:mapping.status,agreementReference:mapping.agreementReference,sourceHeaders:mapped.sourceHeaders,report:'field-mapping.csv',original:'input-original.csv'};if(mapping.status==='synthetic')manifest.scope='Synthetic supplier-header rehearsal; local file preparation only; no customer order or live import';}
  await fs.writeFile(path.join(opts.out,'delivery.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({executionStatus:manifest.executionStatus,deliveryStatus:manifest.deliveryStatus,outputDirectory:opts.out,sourceRows:rows.length,preparedRows:result.ready.length,heldRows:result.held.length,duplicateRows:result.duplicates.length,liveImportVerified:false}));
 }catch(error){await fs.writeFile(path.join(opts.out,'FAILED.json'),JSON.stringify({executionStatus:'failed',error:error.message})+'\n').catch(()=>{});throw error;}
}
main().catch(error=>{console.error(JSON.stringify({executionStatus:'failed',error:error.message}));process.exitCode=1;});
