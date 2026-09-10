// Strict CSV parsing, including quoted delimiters, escaped quotes and embedded newlines.
// Values stay strings so identifiers and blanks do not change type.
export function parseCsv(text) {
  if (text.startsWith('\uFEFF')) text=text.slice(1);
  const records=[]; let row=[], value='', state='start', touched=false;
  const field=()=>{row.push(value);value='';state='start';};
  const record=()=>{field();records.push(row);row=[];touched=false;};
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(state==='quoted') {
      touched=true;
      if(c==='"') {if(text[i+1]==='"'){value+='"';i++;}else state='closed';}
      else value+=c;
      continue;
    }
    if(c===',' ){field();touched=true;continue;}
    if(c==='\n'||c==='\r') {if(c==='\r'&&text[i+1]==='\n')i++;record();continue;}
    if(state==='closed') throw new Error(`Unexpected text after closing quote in CSV record ${records.length+1}`);
    if(c==='"') {if(state!=='start')throw new Error(`Unexpected quote in CSV record ${records.length+1}`);state='quoted';touched=true;continue;}
    value+=c;state='plain';touched=true;
  }
  if(state==='quoted') throw new Error('Unclosed quoted CSV field');
  if(touched||row.length||value.length||state==='closed')record();
  return records;
}
export function recordsToObjects(records,expectedHeaders) {
  if(!records.length)throw new Error('Empty input file');
  const fields=records[0];
  if(new Set(fields).size!==fields.length)throw new Error('Duplicate CSV column names');
  if(fields.length!==expectedHeaders.length||expectedHeaders.some(h=>!fields.includes(h)))throw new Error('Source schema must match the agreed native product columns exactly');
  return records.slice(1).map((record,i)=>{
    if(record.length!==fields.length)throw new Error(`CSV record ${i+2} has ${record.length} fields; expected ${fields.length}`);
    return Object.fromEntries(fields.map((h,j)=>[h,record[j]]));
  });
}
