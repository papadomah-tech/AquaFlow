'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    if (data?.session) {
      // Full page redirect — ensures session cookie is set properly
      window.location.href = '/sales'
    } else {
      setError('Login failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1F4E79] to-[#2E75B6] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">&#128167;</div>
          <h1 className="text-2xl font-bold text-[#1F4E79]">AquaFlow Manager</h1>
          <p className="text-sm text-gray-500 mt-1">VeeBee Ventures &#8212; Crystal Purified Water</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="form-label">Email Address</label>
            <input type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              className="form-input" placeholder="you@example.com" required />
          </div>
          <div>
            <label className="form-label">Password</label>
            <input type="password" value={password}
              onChange={e => setPass(e.target.value)}
              className="form-input" placeholder="Enter password" required />
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="btn btn-primary w-full justify-center py-2.5 text-base">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-6">
          Contact your administrator to create or reset your account.
        </p>
      </div>
    </div>
  )
}
