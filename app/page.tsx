import { redirect } from 'next/navigation'
// Admins land on dashboard; operators/others land on customers
// Actual role check happens client-side; this is just a sensible default
export default function Home() { redirect('/customers') }
