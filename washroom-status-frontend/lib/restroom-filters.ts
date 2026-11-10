type FilterableRestroom = {wheelchair?: string; fee?: string; opening_hours?: string};

export function matchesRestroomFilter(restroom: FilterableRestroom, filter: string): boolean {
  return filter === 'all' ||
    (filter === 'accessible' && restroom.wheelchair === 'yes') ||
    (filter === 'free' && restroom.fee === 'no') ||
    (filter === 'always' && restroom.opening_hours === '24/7');
}
