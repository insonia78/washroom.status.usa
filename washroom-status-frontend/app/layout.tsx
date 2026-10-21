import type { Metadata } from 'next';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';
export const metadata: Metadata = {title:'Washroom Status USA',description:'Find public restrooms and see transparent community reports.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}<footer>Powered by <a href="https://codyza.com" target="_blank" rel="noopener noreferrer">Codyza.com</a></footer></body></html>}
