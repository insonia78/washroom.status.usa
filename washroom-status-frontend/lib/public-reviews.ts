export type PublicReview = {
  id: string;
  rating: number;
  availability: string | null;
  cleanliness_status: string | null;
  issues: string[];
  comment: string;
  created_at: string;
  photo_urls: string[];
  owner_photo_urls?: string[];
};

function isPublicReview(value: unknown): value is PublicReview {
  if (typeof value !== 'object' || value === null) return false;
  const review = value as Record<string, unknown>;
  return typeof review.id === 'string' && typeof review.rating === 'number' &&
    Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5 &&
    (review.availability === null || typeof review.availability === 'string') &&
    (review.cleanliness_status === null || typeof review.cleanliness_status === 'string') &&
    Array.isArray(review.issues) && review.issues.every(issue => typeof issue === 'string') &&
    typeof review.comment === 'string' && typeof review.created_at === 'string' &&
    Number.isFinite(Date.parse(review.created_at)) &&
    Array.isArray(review.photo_urls) && review.photo_urls.every(url => typeof url === 'string') &&
    (review.owner_photo_urls === undefined || Array.isArray(review.owner_photo_urls) &&
      review.owner_photo_urls.every(url => typeof url === 'string'));
}

export function parsePublicReviews(value: unknown, limit: 1 | 50): {
  reviews: PublicReview[];
  average: number | null;
  review_count: number;
} {
  if (typeof value !== 'object' || value === null || !('reviews' in value) ||
    !Array.isArray(value.reviews) || value.reviews.length > limit ||
    !value.reviews.every(isPublicReview)) throw new Error('Invalid reviews response.');
  if (!('review_count' in value) || typeof value.review_count !== 'number' ||
    !Number.isSafeInteger(value.review_count) || value.review_count < 0 ||
    !('average' in value) || (value.average !== null && typeof value.average !== 'number') ||
    (value.review_count === 0 ? value.average !== null :
      typeof value.average !== 'number' || !Number.isFinite(value.average) ||
      value.average < 1 || value.average > 5)) throw new Error('Invalid review grade response.');
  return {reviews: value.reviews, average: value.average, review_count: value.review_count};
}
