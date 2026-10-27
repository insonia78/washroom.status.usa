import type { Metadata } from 'next';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';
export const metadata: Metadata = {title:'Washroom Status USA',description:'Find public restrooms and see transparent community reports.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}<footer className="site-footer"><p className="footer-credit">Powered by</p><a className="footer-brand" href="https://codyza.com" target="_blank" rel="noopener noreferrer">Codyza.com</a><a className="footer-contact" href="mailto:washroom.status.usa@gmail.com">Contact us</a><a className="footer-contact" href="/moderation">Review moderation</a><a className="footer-contact" href="/admin">Owner response admin</a></footer></body></html>}
