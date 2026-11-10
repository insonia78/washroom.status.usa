export function observeReview(element: Element, activate: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    activate();
    return () => {};
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      activate();
    }
  }, {rootMargin: '100px'});
  observer.observe(element);
  return () => observer.disconnect();
}
