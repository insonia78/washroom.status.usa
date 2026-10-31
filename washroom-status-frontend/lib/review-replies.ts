export type AdminReview={
  id:string;user_id:string|null;osm_type:string;osm_id:number;rating:number;
  comment:string;status:'pending'|'approved'|'rejected';created_at:string;
};
export type ReviewReply={
  id:string;review_id:string;recipient_user_id:string|null;body:string;
  status:'draft'|'sending'|'sent'|'failed'|'unknown';created_at:string;
  first_attempt_at:string|null;last_attempt_at:string|null;sent_at:string|null;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null;
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const nullableDate=(value:unknown)=>value===null||date(value);
export function isAdminReview(value:unknown):value is AdminReview{
  return record(value)&&typeof value.id==='string'&&uuid.test(value.id)&&
    (value.user_id===null||typeof value.user_id==='string'&&uuid.test(value.user_id))&&
    typeof value.osm_type==='string'&&['node','way','relation','refuge'].includes(value.osm_type)&&
    typeof value.osm_id==='number'&&Number.isSafeInteger(value.osm_id)&&value.osm_id>0&&
    typeof value.rating==='number'&&Number.isInteger(value.rating)&&value.rating>=1&&value.rating<=5&&
    typeof value.comment==='string'&&typeof value.status==='string'&&
    ['pending','approved','rejected'].includes(value.status)&&date(value.created_at);
}
export function isReviewReply(value:unknown):value is ReviewReply{
  return record(value)&&typeof value.id==='string'&&uuid.test(value.id)&&
    typeof value.review_id==='string'&&uuid.test(value.review_id)&&
    (value.recipient_user_id===null||typeof value.recipient_user_id==='string'&&uuid.test(value.recipient_user_id))&&
    typeof value.body==='string'&&value.body.trim().length>0&&value.body.length<=4000&&
    typeof value.status==='string'&&['draft','sending','sent','failed','unknown'].includes(value.status)&&
    date(value.created_at)&&nullableDate(value.first_attempt_at)&&nullableDate(value.last_attempt_at)&&nullableDate(value.sent_at)&&
    (value.status==='sent'?date(value.sent_at):value.sent_at===null)&&
    (value.status==='draft'||date(value.first_attempt_at)&&date(value.last_attempt_at));
}
