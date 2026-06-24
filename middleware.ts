import { NextResponse, type NextRequest } from 'next/server'

// Simplified middleware — let client-side handle auth redirects
// This prevents middleware from interfering with Supabase session cookies
export async function middleware(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json).*)'],
}
