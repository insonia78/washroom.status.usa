export default function NotFoundView(){
  return <main className="mx-auto max-w-xl px-4 py-24 text-center">
    <p className="text-sm font-bold text-slate-500">404</p>
    <h1 className="mt-2 text-3xl font-extrabold">This page could not be found</h1>
    <p className="mt-3 text-sm text-slate-600">The page you are looking for is not available.</p>
    <a href="/" className="mt-6 inline-block text-sm font-semibold text-teal-800 underline">Back to restroom search</a>
  </main>;
}
