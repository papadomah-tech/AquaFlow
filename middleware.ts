import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value },
        set(name: string, value: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value, ...options } as any)
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value, ...options } as any)
        },
        remove(name: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value: '', ...options } as any)
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value: '', ...options } as any)
        },
      },
    }
  )
  const { data: { session } } = await supabase.auth.getSession()
  const isPublic = request.nextUrl.pathname.startsWith('/login')
  if (!session && !isPublic) return NextResponse.redirect(new URL('/login', request.url))
  if (session && request.nextUrl.pathname === '/login') return NextResponse.redirect(new URL('/dashboard', request.url))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icon).*)'],
}
