import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, password, full_name, role } = await req.json()

    // Validate
    if (!email || !password || !full_name) {
      return NextResponse.json({ error: 'Email, password and name are required.' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }

    // Use service role key — required for admin user creation
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify caller is admin
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const callerClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data: { user: caller } } = await callerClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await adminClient
      .from('profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can create users.' }, { status: 403 })
    }

    // Create the auth user
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,      // auto-confirm — no email needed
      user_metadata: { full_name },
    })

    if (createErr || !newUser?.user) {
      return NextResponse.json(
        { error: createErr?.message ?? 'Failed to create user.' },
        { status: 400 }
      )
    }

    // Set profile row (trigger may have already created it)
    await adminClient.from('profiles').upsert({
      id:        newUser.user.id,
      full_name,
      role:      role ?? 'operator',
      is_active: true,
      permissions: ['sales', 'customers'],
    })

    return NextResponse.json({ success: true, userId: newUser.user.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
