'use client'
export const dynamic = 'force-dynamic'
import { useState } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { supabase } from '@/lib/supabase'

export default function ChangePasswordPage() {
  const [current, setCurrent]     = useState('')
  const [newPwd, setNewPwd]       = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [success, setSuccess]     = useState(false)
  const [error, setError]         = useState('')

  const handleChange = async () => {
    setError(''); setSuccess(false)

    if (!newPwd) { setError('Enter a new password.'); return }
    if (newPwd.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (newPwd !== confirm) { setError('Passwords do not match.'); return }

    setSaving(true)

    // Re-authenticate with current password first
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { setError('Could not get your account.'); setSaving(false); return }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: user.email, password: current
    })
    if (signInErr) {
      setError('Current password is incorrect.')
      setSaving(false); return
    }

    // Now update to new password
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd })
    if (updateErr) {
      setError(updateErr.message)
      setSaving(false); return
    }

    setSuccess(true)
    setCurrent(''); setNewPwd(''); setConfirm('')
    setSaving(false)
  }

  const strong = newPwd.length >= 8 && /[0-9]/.test(newPwd) && /[A-Z]/.test(newPwd)
  const ok     = newPwd.length >= 6

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">🔑 Change My Password</h1>
      </div>

      <div className="max-w-md mx-auto">
        <div className="card">
          {success && (
            <div className="mb-4 bg-green-50 border border-green-200 text-green-700
                            rounded-xl p-4 text-sm font-medium text-center">
              ✅ Password changed successfully!
            </div>
          )}
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700
                            rounded-xl p-3 text-sm">
              ❌ {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <input
                type={showPwd ? 'text' : 'password'}
                value={current}
                onChange={e => setCurrent(e.target.value)}
                className="form-input"
                placeholder="Your current password" />
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  className="form-input pr-16"
                  placeholder="At least 6 characters" />
                <button type="button"
                  onClick={() => setShowPwd(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2
                             text-xs text-gray-400 hover:text-gray-700">
                  {showPwd ? 'Hide' : 'Show'}
                </button>
              </div>
              {/* Strength indicator */}
              {newPwd && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1,2,3].map(i => (
                      <div key={i} className={'h-1.5 flex-1 rounded-full transition-colors '
                        + (i === 1 && newPwd.length >= 6 ? 'bg-orange-400'
                        : i === 2 && newPwd.length >= 8 ? 'bg-yellow-400'
                        : i === 3 && strong ? 'bg-green-500'
                        : 'bg-gray-200')} />
                    ))}
                  </div>
                  <div className={'text-xs '
                    + (strong ? 'text-green-600' : ok ? 'text-orange-500' : 'text-red-500')}>
                    {strong ? '✅ Strong password'
                     : ok ? '⚠️ Add numbers and uppercase for a stronger password'
                     : '❌ Too short — minimum 6 characters'}
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="form-input"
                placeholder="Repeat new password" />
              {confirm && newPwd !== confirm && (
                <div className="text-xs text-red-500 mt-1">❌ Passwords do not match</div>
              )}
              {confirm && newPwd === confirm && newPwd.length >= 6 && (
                <div className="text-xs text-green-600 mt-1">✅ Passwords match</div>
              )}
            </div>

            <button
              onClick={handleChange}
              disabled={saving || !current || !newPwd || !confirm || newPwd !== confirm}
              className="btn btn-primary w-full justify-center py-2.5">
              {saving ? '⏳ Changing...' : '🔑 Change Password'}
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
            If you forgot your current password, contact your administrator to reset it.
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
