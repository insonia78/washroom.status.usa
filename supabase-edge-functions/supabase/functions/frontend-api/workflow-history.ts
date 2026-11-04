// Builds read-only, time-ordered workflow steps for the admin review and toilet cards.

export type WorkflowStep = { at: string; label: string; detail?: string };

type Row = Record<string, unknown>;

const text = (value: unknown): string | null => typeof value === "string" && value ? value : null;

function ordered(steps: (WorkflowStep | null)[]): WorkflowStep[] {
  return steps.filter((step): step is WorkflowStep => step !== null && !Number.isNaN(Date.parse(step.at)))
    .map((step, index) => ({ step, index }))
    .sort((a, b) => Date.parse(a.step.at) - Date.parse(b.step.at) || a.index - b.index)
    .map(({ step }) => step);
}

function step(at: unknown, label: string, detail?: string): WorkflowStep | null {
  const time = text(at);
  if (!time) return null;
  return detail ? { at: time, label, detail } : { at: time, label };
}

function photoCount(count: number): string | undefined {
  return count ? `${count} photo${count === 1 ? "" : "s"} attached` : undefined;
}

export function reviewHistory(input: {
  review: Row;
  moderation: Row[];
  invites: Row[];
  ownerReplies: Row[];
  ownerPhotos: Row[];
  privateReplies: Row[];
}): WorkflowStep[] {
  const { review } = input;
  const photos = Array.isArray(review.photo_paths) ? review.photo_paths.length : 0;
  const steps: (WorkflowStep | null)[] = [step(review.created_at, "Review submitted", photoCount(photos))];
  for (const decision of input.moderation) {
    const note = text(decision.note);
    steps.push(step(decision.created_at,
      decision.decision === "approved" ? "Moderator approved the review" : "Moderator rejected the review",
      note ? `Note: ${note}` : undefined));
  }
  for (const invite of input.invites) {
    steps.push(step(invite.created_at, "Owner invited", text(invite.email) ?? undefined));
  }
  for (const reply of input.ownerReplies) {
    const business = text(reply.business_name) ?? "Business owner";
    const count = Array.isArray(reply.photos) ? reply.photos.length : 0;
    steps.push(step(reply.created_at, "Owner replied", [business, photoCount(count)].filter(Boolean).join(" - ")));
    const rejectedByModerator = reply.status === "rejected" && !reply.published_at;
    steps.push(step(reply.moderated_at, rejectedByModerator ? "Moderator rejected the owner reply" : "Moderator approved the owner reply"));
    steps.push(step(reply.published_at, reply.status === "rejected" ? "Administrator rejected the owner reply" : "Administrator published the owner reply"));
    steps.push(step(reply.archived_at, "Owner reply archived"));
  }
  for (const photo of input.ownerPhotos) {
    steps.push(step(photo.uploaded_at, "Owner photo uploaded"));
    if (photo.status === "added") steps.push(step(photo.reviewed_at, "Administrator added the owner photo to the review"));
  }
  for (const reply of input.privateReplies) {
    steps.push(step(reply.created_at, "Private reply drafted"));
    steps.push(step(reply.sent_at, "Private reply emailed to the reviewer"));
  }
  steps.push(step(review.archived_at, "Review archived"));
  return ordered(steps);
}

export function toiletHistory(toilet: Row): WorkflowStep[] {
  const photos = Array.isArray(toilet.photo_paths) ? toilet.photo_paths.length : 0;
  return ordered([
    step(toilet.created_at, "Toilet submitted", photoCount(photos)),
    step(toilet.moderated_at, toilet.status === "rejected" ? "Moderator rejected the toilet" : "Moderator approved the toilet"),
    step(toilet.published_at, "Administrator gave final approval - published on the map"),
    step(toilet.archived_at, "Toilet archived"),
  ]);
}

export type ReviewStage = "moderation" | "administration" | "waiting_owner" | "owner_reply" | "completed" | "archived";
export type ToiletStage = "moderation" | "awaiting_admin" | "published" | "rejected" | "archived";

// The single board column a review belongs to, based on the steps already taken.
export function reviewStage(input: { review: Row; invites: Row[]; ownerReplies: Row[]; privateReplies: Row[] }): ReviewStage {
  const { review } = input;
  if (text(review.archived_at)) return "archived";
  if (review.status === "pending") return "moderation";
  const activeReplies = input.ownerReplies.filter(reply => !text(reply.archived_at));
  if (activeReplies.some(reply => reply.status === "pending" || reply.status === "moderated")) return "owner_reply";
  if (input.ownerReplies.some(reply => reply.status === "published") ||
    input.privateReplies.some(reply => reply.status === "sent")) return "completed";
  if (input.invites.length) return "waiting_owner";
  return "administration";
}

export function toiletStage(toilet: Row): ToiletStage {
  if (text(toilet.archived_at)) return "archived";
  if (toilet.status === "pending") return "moderation";
  if (toilet.status === "rejected") return "rejected";
  return text(toilet.published_at) ? "published" : "awaiting_admin";
}

// Owner photos attached to a private reply email: the latest published owner reply photos first,
// then legacy administrator-added owner photos, capped at the 3-photo email limit.
export function emailOwnerPhotoPaths(publishedReplyPhotoPaths: string[], addedOwnerPhotoPaths: string[]): string[] {
  return [...new Set([...publishedReplyPhotoPaths, ...addedOwnerPhotoPaths])].slice(0, 3);
}
