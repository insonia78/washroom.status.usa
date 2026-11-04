export type OwnerResponse={
  id:string;osm_type:string;osm_id:number;review_id:string|null;business_name:string;body:string;
  completed_on:string|null;evidence_url:string|null;published_at:string|null;photo_urls?:string[];
};
export type AdminOwnerResponse=OwnerResponse&{
  verification_note:string;status:'draft'|'published';version:number;updated_at:string;archived_at?:string|null;
};

export function isEvidenceUrl(value:unknown):value is string{
  if(typeof value!=='string'||value.length>2000)return false;
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;
  }catch{return false}
}

export function isOwnerResponse(value:unknown):value is OwnerResponse{
  if(typeof value!=='object'||value===null)return false;
  const row=value as Record<string,unknown>;
  return typeof row.id==='string'&&typeof row.osm_type==='string'&&['node','way','relation','refuge'].includes(row.osm_type)&&
    typeof row.osm_id==='number'&&Number.isSafeInteger(row.osm_id)&&row.osm_id>0&&
    (row.review_id===null||typeof row.review_id==='string')&&
    typeof row.business_name==='string'&&typeof row.body==='string'&&
    (row.photo_urls===undefined||Array.isArray(row.photo_urls)&&row.photo_urls.every(url=>typeof url==='string'))&&
    (row.completed_on===null||typeof row.completed_on==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(row.completed_on)&&Number.isFinite(Date.parse(row.completed_on)))&&
    (row.evidence_url===null||isEvidenceUrl(row.evidence_url))&&
    (row.published_at===null||typeof row.published_at==='string'&&Number.isFinite(Date.parse(row.published_at)));
}

export function isAdminOwnerResponse(value:unknown):value is AdminOwnerResponse{
  if(!isOwnerResponse(value))return false;
  const row=value as OwnerResponse&Record<string,unknown>;
  return typeof row.verification_note==='string'&&['draft','published'].includes(String(row.status))&&
    typeof row.version==='number'&&Number.isSafeInteger(row.version)&&row.version>0&&
    typeof row.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at))&&
    (row.status==='published'?row.published_at!==null:row.published_at===null);
}
