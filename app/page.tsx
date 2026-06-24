import { redirect } from 'next/navigation'
// Default landing — middleware/AppLayout handles role-based redirect
export default function Home() { redirect('/sales') }
