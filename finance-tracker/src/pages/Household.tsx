import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, Crown } from 'lucide-react'
import { MemberAvatar } from '../components/MemberAvatar'
import { BottomSheet } from '../components/BottomSheet'
import { useAuth } from '../context/AuthContext'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import { getMyHousehold, getMonthlyStats, getActivity, leaveHousehold } from '../api/households'
import type { HouseholdData, MonthlyStats, ActivityItem } from '../api/households'

const CAT_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EC4899', '#A78BFA', '#F97316']

function timeAgo(iso: string, ht: { timeJustNow: string; timeMinutes: string; timeHours: string; timeYesterday: string; timeDays: string }): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 2) return ht.timeJustNow
  if (mins < 60) return ht.timeMinutes.replace('{n}', String(mins))
  if (hours < 24) return ht.timeHours.replace('{n}', String(hours))
  if (days === 1) return ht.timeYesterday
  return ht.timeDays.replace('{n}', String(days))
}

export function HouseholdPage() {
  const { user, refreshUser } = useAuth()
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()
  const { household: ht } = t

  const [householdData, setHouseholdData] = useState<HouseholdData | null>(null)
  const [stats, setStats] = useState<MonthlyStats | null>(null)
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [leavePending, setLeavePending] = useState(false)
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const householdEnabled = user?.household_enabled ?? false
  const householdId = user?.household_id ?? null

  const handleLeaveHousehold = async () => {
    setLeaveLoading(true)
    try {
      await leaveHousehold()
      localStorage.removeItem('finvu_dashboard_view')
      await refreshUser()
      setLeavePending(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert(msg ?? ht.leaveError)
    } finally {
      setLeaveLoading(false)
    }
  }

  const load = useCallback(async () => {
    if (!householdEnabled || !householdId) { setLoading(false); return }
    setLoading(true)
    try {
      const [hd, ms, activity] = await Promise.all([
        getMyHousehold(),
        getMonthlyStats(householdId),
        getActivity(householdId, 10),
      ])
      setHouseholdData(hd)
      setStats(ms)
      setActivityFeed(activity)
    } catch { /* not authenticated or no household */ }
    setLoading(false)
  }, [householdEnabled, householdId])

  useEffect(() => { load() }, [load])

  const handleCopy = () => {
    if (!householdData?.invite_code) return
    navigator.clipboard.writeText(householdData.invite_code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!householdEnabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '64px 20px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--bg2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>👨‍👩‍👧</div>
        <p style={{ fontSize: 14, color: 'var(--text3)', maxWidth: 280 }}>{ht.notEnabled}</p>
        <button
          onClick={() => { window.location.hash = 'settings' }}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--violet)', background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', padding: '8px 20px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {ht.enableInSettings}
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--violet)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  const totalIncome = stats?.total_income ?? 0
  const totalExpenses = stats?.total_expenses ?? 0
  const balance = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? Math.round((balance / totalIncome) * 100) : 0
  const memberCount = householdData?.members.length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))' }}>

      {/* ── Hero card ── */}
      <div style={{
        background: 'linear-gradient(135deg,#1a1235 0%,#3d2a82 50%,#1a1235 100%)',
        borderRadius: 24, padding: '24px 26px 20px', position: 'relative', overflow: 'hidden', color: 'white',
        boxShadow: '0 18px 50px -16px rgba(58,42,130,0.45),0 0 0 1px rgba(139,92,246,0.2)',
        flexShrink: 0,
      }}>
        <div style={{ position: 'absolute', top: -80, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(167,139,250,0.4),transparent 65%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 30%,rgba(255,255,255,0.04) 50%,transparent 70%)', pointerEvents: 'none' }} />
        {/* Avatar stack top-right */}
        <div style={{ position: 'absolute', top: 22, right: 22, display: 'flex' }}>
          {(householdData?.members ?? []).slice(0, 4).map((m, i) => (
            <div key={m.id} style={{ marginLeft: i > 0 ? -10 : 0, zIndex: 10 - i, borderRadius: '50%', border: '2px solid rgba(26,18,53,0.8)' }}>
              <MemberAvatar userId={m.id} userName={m.name} size={34} avatarUrl={m.avatar_url} />
            </div>
          ))}
          {memberCount > 4 && (
            <div style={{ marginLeft: -10, width: 34, height: 34, borderRadius: '50%', background: 'rgba(139,92,246,0.25)', border: '2px solid rgba(26,18,53,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white', zIndex: 5 }}>
              +{memberCount - 4}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.9)' }}>DOMÁCNOSŤ</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
            <span style={{ fontSize: 11, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.55)' }}>
              Rodina {householdData?.name ?? ht.title}
            </span>
          </div>
          <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.55)', fontWeight: 600, marginBottom: 6, letterSpacing: '0.12em', textTransform: 'uppercase' as const }}>{ht.sharedBalance}</p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 14, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: balance >= 0 ? '#86efac' : '#fca5a5', marginRight: 2 }}>{balance >= 0 ? '+' : '−'}</span>
            <span style={{ fontSize: 46, fontWeight: 300, color: 'white', letterSpacing: '-1.8px', lineHeight: 1 }}>{Math.floor(Math.abs(balance)).toLocaleString('sk-SK')}</span>
            <span style={{ fontSize: 22, fontWeight: 300, color: 'rgba(255,255,255,0.78)', letterSpacing: '-0.4px', marginLeft: 1 }}>,{String(Math.round((Math.abs(balance) % 1) * 100)).padStart(2, '0')}</span>
            <span style={{ fontSize: 22, fontWeight: 400, color: 'rgba(255,255,255,0.55)', marginLeft: 6 }}>€</span>
            <span style={{
              marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
              background: savingsRate >= 0 ? 'rgba(52,211,153,0.18)' : 'rgba(248,113,113,0.18)',
              color: savingsRate >= 0 ? '#86efac' : '#fca5a5',
              border: `1px solid ${savingsRate >= 0 ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
            }}>
              {savingsRate >= 0 ? `+${savingsRate}% ${ht.savings}` : ht.inMinus}
            </span>
          </div>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 3 }}>{ht.totalIncomeStat}</p>
              <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, fontSize: 15, color: '#86efac' }}>+{formatAmount(totalIncome)}</p>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 3 }}>{ht.totalExpensesStat}</p>
              <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, fontSize: 15, color: '#fca5a5' }}>−{formatAmount(totalExpenses)}</p>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.12)' }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 3 }}>{ht.membersCount}</p>
              <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, fontSize: 15, color: 'white' }}>{memberCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── ČLENOVIA section header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--text3)', flexShrink: 0 }}>{ht.membersSection} ({memberCount})</p>
        {householdData && (
          leavePending ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{ht.confirmLeave}</span>
              <button
                onClick={() => setLeavePending(false)}
                style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
              >{t.common.cancel}</button>
              <button
                onClick={handleLeaveHousehold}
                disabled={leaveLoading}
                style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: 'var(--red)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: leaveLoading ? 0.6 : 1 }}
              >{leaveLoading ? '...' : ht.confirmBtn}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {householdData.invite_code && (
                <button
                  onClick={() => setInviteOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {ht.inviteMember}
                </button>
              )}
              <button
                onClick={() => setLeavePending(true)}
                style={{ padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
              >{ht.leaveHousehold}</button>
            </div>
          )
        )}
      </div>

      {/* ── Member cards grid ── */}
      {householdData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {householdData.members.map((m, mi) => {
            const memberStats = stats?.per_member.find(p => p.user_id === m.id)
            const inc = memberStats?.income ?? 0
            const exp = memberStats?.expenses ?? 0
            const bal = inc - exp
            // Simulated category breakdown from member color
            const memberColor = CAT_COLORS[mi % CAT_COLORS.length]
            const catBreakdown = [
              { name: 'Potraviny', val: exp * 0.4, color: CAT_COLORS[0] },
              { name: 'Doprava', val: exp * 0.25, color: CAT_COLORS[1] },
              { name: 'Ostatné', val: exp * 0.35, color: CAT_COLORS[2] },
            ].filter(c => c.val > 0)
            return (
              <div
                key={m.id}
                style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20,
                  padding: 20, boxShadow: 'var(--card-shadow)', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-elevated)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--card-shadow)' }}
              >
                {/* Avatar + name + role */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <MemberAvatar userId={m.id} userName={m.name} size={52} avatarUrl={m.avatar_url} />
                    {/* Online dot */}
                    <div style={{ position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: '50%', background: '#34d399', border: '2px solid var(--bg2)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</p>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {m.is_owner ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: 'rgba(139,92,246,0.13)', color: 'var(--violet)', border: '1px solid rgba(139,92,246,0.2)' }}>
                          <Crown size={9} /> {ht.owner}
                        </span>
                      ) : (
                        <span style={{ fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}>
                          {ht.member}
                        </span>
                      )}
                      <span style={{ fontSize: 10, width: 4, height: 4, borderRadius: '50%', background: memberColor, display: 'inline-block' }} />
                    </div>
                  </div>
                </div>

                {/* 3-col mini stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: 'rgba(22,163,74,0.08)', borderRadius: 10 }}>
                    <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 2 }}>{ht.incomeStat}</p>
                    <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>+{formatAmount(inc)}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: 'rgba(220,38,38,0.07)', borderRadius: 10 }}>
                    <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 2 }}>{ht.expensesStat}</p>
                    <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 13, color: 'var(--red)' }}>−{formatAmount(exp)}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px 6px', background: 'rgba(139,92,246,0.08)', borderRadius: 10 }}>
                    <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 2 }}>{ht.balanceStat}</p>
                    <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 13, color: bal >= 0 ? 'var(--violet)' : 'var(--red)' }}>
                      {bal >= 0 ? '+' : '−'}{formatAmount(Math.abs(bal))}
                    </p>
                  </div>
                </div>

                {/* Rozdelenie výdavkov */}
                {exp > 0 && (
                  <>
                    <p style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 }}>{ht.expenseBreakdown}</p>
                    <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', marginBottom: 8 }}>
                      {catBreakdown.map((c, j) => (
                        <div key={j} style={{ flex: c.val, background: c.color, transition: 'flex 0.7s' }} title={`${c.name}: ${formatAmount(c.val)}`} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8 }}>
                      {catBreakdown.map((c, j) => {
                        const catTotal = catBreakdown.reduce((s, x) => s + x.val, 0)
                        return (
                          <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
                            {c.name} <span style={{ fontFamily: "'DM Mono',monospace", color: 'var(--text2)' }}>{catTotal > 0 ? Math.round((c.val / catTotal) * 100) : 0}%</span>
                          </span>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Activity feed ── */}
      {activityFeed.length > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 20px', boxShadow: 'var(--card-shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--text3)' }}>{ht.activityLabel}</p>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(52,211,153,0.13)', color: 'var(--green)', fontWeight: 700 }}>● Live</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {activityFeed.map((a, i) => {
              const member = householdData?.members.find(m => m.id === a.created_by)
              const name = a.created_by_name ?? member?.name ?? '?'
              const isIncome = a.type === 'income'
              const actionText = isIncome ? ht.addedIncome : ht.addedExpense
              return (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: i < activityFeed.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                  <MemberAvatar
                    userId={a.created_by ?? 'unknown'}
                    userName={name}
                    size={28}
                    avatarUrl={member?.avatar_url ?? null}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600 }}>{name}</span>
                      <span style={{ color: 'var(--text3)' }}> {actionText} </span>
                      <span style={{ fontWeight: 500 }}>{a.description ?? '—'}</span>
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono',monospace" }}>{timeAgo(a.created_at, ht)}</p>
                  </div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600, color: isIncome ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>
                    {isIncome ? '+' : '−'}{formatAmount(a.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Invite BottomSheet ── */}
      <BottomSheet open={inviteOpen} onClose={() => setInviteOpen(false)} title={ht.inviteMember}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 14, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6 }}>
            {ht.inviteCodeDesc}
          </div>
          <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 16, padding: '20px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
              {ht.inviteCode}
            </div>
            <code style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: 'var(--violet)', letterSpacing: '4px', fontSize: 28 }}>
              {householdData?.invite_code}
            </code>
          </div>
          <button
            onClick={handleCopy}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, padding: '0 32px', borderRadius: 14, background: copied ? 'rgba(52,211,153,0.15)' : 'linear-gradient(135deg, #7C3AED, #6D28D9)', color: copied ? '#34D399' : 'white', fontSize: 15, fontWeight: 600, border: copied ? '1px solid rgba(52,211,153,0.3)' : 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', width: '100%', justifyContent: 'center' }}
          >
            {copied ? <><Check size={16} /> {ht.copied}</> : <><Copy size={16} /> {ht.copyCodeBtn}</>}
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
