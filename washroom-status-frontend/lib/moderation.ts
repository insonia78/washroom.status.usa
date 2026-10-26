export type PendingReview={
  id:string;osm_type:string;osm_id:number;rating:number;availability:string|null;
  cleanliness_status:string|null;issues:string[];comment:string;created_at:string;status:'pending';
};

export function isPendingReview(value:unknown):value is PendingReview{
  if(typeof value!=='object'||value===null)return false;
  const review=value as Record<string,unknown>;
  return typeof review.id==='string'&&typeof review.osm_type==='string'&&['node','way','relation','refuge'].includes(review.osm_type)&&
    typeof review.osm_id==='number'&&Number.isSafeInteger(review.osm_id)&&review.osm_id>0&&
    typeof review.rating==='number'&&Number.isInteger(review.rating)&&review.rating>=1&&review.rating<=5&&
    (review.availability===null||typeof review.availability==='string')&&
    (review.cleanliness_status===null||typeof review.cleanliness_status==='string')&&
    Array.isArray(review.issues)&&review.issues.every(issue=>typeof issue==='string')&&
    typeof review.comment==='string'&&typeof review.created_at==='string'&&Number.isFinite(Date.parse(review.created_at))&&review.status==='pending';
}
