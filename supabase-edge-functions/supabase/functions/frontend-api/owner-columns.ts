export const publicOwnerColumns = "id,osm_type,osm_id,review_id,business_name,body,completed_on,evidence_url,published_at";
export const publicOwnerPhotoColumns = `${publicOwnerColumns},photo_paths`;
export const adminOwnerColumns = `${publicOwnerColumns},verification_note,status,version,updated_at,archived_at`;
export const replyColumns = "id,review_id,recipient_user_id,body,status,created_by,last_sent_by,created_at,first_attempt_at,last_attempt_at,sent_at,provider_id";

export const ownerReplyColumns = "id,invite_id,review_id,osm_type,osm_id,owner_email,business_name,body,status,created_at,moderated_at,published_at,archived_at";
