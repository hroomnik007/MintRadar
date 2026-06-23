import { apiClient } from './client'
import type { AuthUser, UserSession } from '../types'
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'

export async function login(email: string, password: string): Promise<{ user: AuthUser; accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/login', { email, password })
  return data
}

export async function register(
  email: string,
  password: string,
  name: string,
  gdprConsent: boolean,
): Promise<{ message: string }> {
  const { data } = await apiClient.post('/api/auth/register', { email, password, name, gdprConsent })
  return data
}

export async function logout(): Promise<void> {
  await apiClient.post('/api/auth/logout')
}

export async function refreshToken(): Promise<{ accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/refresh')
  return data
}

export async function getMe(): Promise<{ user: AuthUser }> {
  const { data } = await apiClient.get('/api/auth/me')
  return data
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  const { data } = await apiClient.get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
  return data
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const { data } = await apiClient.post('/api/auth/forgot-password', { email })
  return data
}

export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  const { data } = await apiClient.post('/api/auth/reset-password', { token, newPassword })
  return data
}

export async function deleteAccount(): Promise<void> {
  await apiClient.delete('/api/auth/account')
}

export async function updateAvatar(avatarUrl: string): Promise<{ avatarUrl: string }> {
  const { data } = await apiClient.patch('/api/auth/avatar', { avatarUrl })
  return data
}

export async function demoLogin(): Promise<{ user: import('../types').AuthUser; accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/demo-login')
  return data
}

export async function adminLogin(username: string, password: string): Promise<{ token: string }> {
  const { data } = await apiClient.post('/api/auth/admin-login', { username, password })
  return data
}

export async function updateWeeklyEmail(enabled: boolean): Promise<{ weeklyEmailEnabled: boolean }> {
  const { data } = await apiClient.patch('/api/auth/weekly-email', { enabled })
  return data
}

export async function googleLogin(accessToken: string): Promise<{ user: import('../types').AuthUser; accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/google', { accessToken })
  return data
}

export async function updateUserSettings(settings: {
  onboardingComplete?: boolean
  monthlyEmailEnabled?: boolean
  defaultPage?: string
  currencyFormat?: string
  theme?: string
  savingsEnabled?: boolean
  trackingStartDate?: string | null
  onboardingBannerDismissed?: boolean
  language?: string
  autoLockMinutes?: number | null
}): Promise<void> {
  await apiClient.patch('/api/auth/settings', settings)
}

export async function getSessions(): Promise<UserSession[]> {
  const { data } = await apiClient.get('/api/auth/sessions')
  return (data as { data: UserSession[] }).data
}

export async function deleteSessionById(sessionId: string): Promise<void> {
  await apiClient.delete(`/api/auth/sessions/${sessionId}`)
}

export async function deactivateAccount(): Promise<void> {
  await apiClient.post('/api/auth/deactivate')
}

export async function createSharedReport(data: string, expiresInHours?: number): Promise<{ token: string }> {
  const { data: res } = await apiClient.post('/api/reports', { data, expiresInHours })
  return res
}

export async function getSharedReport(token: string): Promise<{ data: string }> {
  const { data } = await apiClient.get(`/api/reports/${token}`)
  return data
}

export async function pinLogin(email: string, pin: string): Promise<{ user: import('../types').AuthUser; accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/pin-login', { email, pin })
  return data
}

export async function savePin(pin: string): Promise<void> {
  await apiClient.patch('/api/auth/pin', { pin })
}

export async function deletePin(): Promise<void> {
  await apiClient.delete('/api/auth/pin')
}

export async function webauthnRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { data } = await apiClient.get('/api/auth/webauthn/register-options')
  return data
}

export async function webauthnRegisterVerify(body: object): Promise<{ success: boolean }> {
  const { data } = await apiClient.post('/api/auth/webauthn/register-verify', body)
  return data
}

export async function webauthnAuthenticateOptions(email?: string): Promise<object> {
  const { data } = await apiClient.get('/api/auth/webauthn/authenticate-options', { params: email ? { email } : {} })
  return data
}

export async function webauthnAuthenticateVerify(body: object): Promise<{ user: import('../types').AuthUser; accessToken: string }> {
  const { data } = await apiClient.post('/api/auth/webauthn/authenticate-verify', body)
  return data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.patch('/api/auth/password', { currentPassword, newPassword })
}

export async function getAuthMethods(email: string): Promise<{ pin: boolean; google: boolean; password: boolean }> {
  const { data } = await apiClient.get("/api/auth/methods", { params: { email } })
  return data
}

export async function updateProfile(fields: { phone?: string; country?: string }): Promise<void> {
  await apiClient.patch('/api/auth/profile', fields)
}

export async function sessionCheck(): Promise<{ valid: boolean; reason?: string }> {
  const { data } = await apiClient.get('/api/auth/session-check')
  return data
}

export async function pingSession(): Promise<void> {
  await apiClient.get('/api/auth/ping')
}
