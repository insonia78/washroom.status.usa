import type {WorkflowStep} from '@/lib/review-replies';

export default function StepHistory({steps,label}:{steps?:WorkflowStep[];label:string}){
  if(!steps?.length)return null;
  return <details open className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <summary className="cursor-pointer text-sm font-semibold">{label} ({steps.length} step{steps.length===1?'':'s'})</summary>
    <ol aria-label={label} className="mt-3 space-y-3 border-l-2 border-teal-700 pl-4">
      {steps.map((step,index)=><li key={`${step.at}-${index}`} className="relative">
        <span aria-hidden="true" className="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-teal-700 text-[0.6rem] font-bold text-white">{index+1}</span>
        <p className="text-sm font-semibold">{step.label}</p>
        <p className="text-xs text-slate-600"><time dateTime={step.at}>{new Date(step.at).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</time></p>
        {step.detail&&<p className="break-words text-xs text-slate-700">{step.detail}</p>}
      </li>)}
    </ol>
  </details>;
}
