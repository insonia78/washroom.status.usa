export type AdminReview={
  id:string;user_id:string|null;osm_type:string;osm_id:number;rating:number;
  availability:string|null;cleanliness_status:string|null;issues:string[];comment:string;
  photo_urls:string[];  status:'pending'|'approved'|'rejected';created_at:string;archived_at:string|null;restroom_name?:string|null;
  owner_photos?:{id:string;photo_url:string;status:'pending'|'added'}[];
  owner_replies?:{id:string;business_name:string;body:string;status:'pending'|'moderated'|'published'|'rejected';created_at:string;archived_at:string|null;
    photos:{id:string;photo_url:string;status:'pending'|'moderated'|'published'|'rejected'}[]}[];
  email_photos?:{id:string;photo_url:string}[];
  history?:WorkflowStep[];
  stage?:ReviewStage;
  };
export type ReviewStage='moderation'|'administration'|'waiting_owner'|'owner_reply'|'completed'|'archived';
export const reviewStages:readonly ReviewStage[]=['moderation','administration','waiting_owner','owner_reply','completed','archived'];
export type WorkflowStep={at:string;label:string;detail?:string};
export const isWorkflowHistory=(value:unknown):value is WorkflowStep[]|undefined=>value===undefined||Array.isArray(value)&&value.every(step=>
  typeof step==='object'&&step!==null&&typeof step.at==='string'&&typeof step.label==='string'&&
  (step.detail===undefined||typeof step.detail==='string'));
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
    (value.availability===null||typeof value.availability==='string')&&
    (value.cleanliness_status===null||typeof value.cleanliness_status==='string')&&
    Array.isArray(value.issues)&&value.issues.every(issue=>typeof issue==='string')&&
    typeof value.comment==='string'&&typeof value.status==='string'&&
    Array.isArray(value.photo_urls)&&value.photo_urls.every(url=>typeof url==='string')&&
    (value.owner_photos===undefined||Array.isArray(value.owner_photos)&&value.owner_photos.every(photo=>
      record(photo)&&typeof photo.id==='string'&&uuid.test(photo.id)&&typeof photo.photo_url==='string'&&
      (photo.status==='pending'||photo.status==='added')))&&
    (value.owner_replies===undefined||Array.isArray(value.owner_replies)&&value.owner_replies.every(reply=>
      record(reply)&&typeof reply.id==='string'&&typeof reply.business_name==='string'&&typeof reply.body==='string'&&
      typeof reply.status==='string'&&['pending','moderated','published','rejected'].includes(reply.status)&&
      Array.isArray(reply.photos)&&reply.photos.every(photo=>record(photo)&&typeof photo.id==='string'&&
        typeof photo.photo_url==='string'&&typeof photo.status==='string')))&&
    (value.email_photos===undefined||Array.isArray(value.email_photos)&&value.email_photos.every(photo=>
      record(photo)&&typeof photo.id==='string'&&typeof photo.photo_url==='string'))&&
    isWorkflowHistory(value.history)&&
    (value.stage===undefined||typeof value.stage==='string'&&(reviewStages as readonly string[]).includes(value.stage))&&
    ['pending','approved','rejected'].includes(value.status)&&date(value.created_at)&&nullableDate(value.archived_at);
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
