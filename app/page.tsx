import { redirect } from 'next/navigation'
// Non-admins land on sales; admins land on sales too (they can go to dashboard manually)
// This prevents the "Access Restricted" flash on login
export default function Home() { redirect('/sales') }
