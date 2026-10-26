export function starFillPercent(average:number|null,star:number):number{
  if(average===null)return 0;
  return Math.max(0,Math.min(1,average-star+1))*100;
}
