export function restroomLabel(restroom:{category?:string;toilets?:string}){
  const category=restroom.category==='fuel'?'Gas station':restroom.category==='supermarket'?'Supermarket':null;
  if(!category)return 'Restroom listing';
  return `${category} · ${restroom.toilets==='yes'?'Toilets listed':restroom.toilets==='no'?'No toilets listed':'Restroom availability unconfirmed'}`;
}
