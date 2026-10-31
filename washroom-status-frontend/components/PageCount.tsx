export default function PageCount({offset,total}:{offset:number;total:number|null}){
  if(total===null)return null;
  const pages=Math.max(1,Math.ceil(total/3));
  return <span className="text-xs font-semibold text-slate-600" aria-live="polite">Page {Math.floor(offset/3)+1} of {pages}</span>;
}
