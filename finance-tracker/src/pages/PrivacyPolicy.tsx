export function PrivacyPolicyPage() {
  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{ background: 'var(--bg-primary)', color: '#E2D9F3' }}
    >
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => window.history.back()}
          className="text-[#A78BFA] hover:text-[#C4B5FD] text-sm mb-6 transition-colors"
        >
          ← Späť
        </button>

        <h1 className="text-2xl font-bold mb-6">Zásady ochrany súkromia — Finvu</h1>
        <p className="text-xs text-[#6B5A9E] mb-8">Platné od: 1. januára 2025</p>

        <div className="flex flex-col gap-6 text-sm text-[#B8A3E8] leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">1. Správca údajov</h2>
            <p>Správcom osobných údajov je prevádzkovateľ aplikácie Finvu dostupnej na adrese finvu.pedani.eu.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">2. Aké údaje zbierame</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Meno a emailová adresa (pri registrácii)</li>
              <li>Finančné záznamy, ktoré sami zadáte (príjmy, výdavky, kategórie)</li>
              <li>Technické údaje potrebné pre fungovanie aplikácie (IP adresa, čas prihlásenia)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">3. Účel spracovania</h2>
            <p>Vaše údaje spracúvame výlučne za účelom poskytovania funkcionality aplikácie Finvu — evidencie osobných financií. Údaje nepredávame tretím stranám ani ich nepoužívame na marketingové účely.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">4. Ukladanie údajov</h2>
            <p>Vaše dáta sú bezpečne uložené na serveri v EU. Prenos dát je šifrovaný pomocou HTTPS. Heslá sú ukladané iba v zahashovanej forme (bcrypt).</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">5. Vaše práva</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Právo na prístup k vašim údajom</li>
              <li>Právo na opravu nesprávnych údajov</li>
              <li>Právo na vymazanie účtu a všetkých údajov (dostupné v Nastaveniach aplikácie)</li>
              <li>Právo na prenosnosť údajov (export do JSON dostupný v Nastaveniach)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">6. Cookies</h2>
            <p>Aplikácia používa iba nevyhnutné technické cookies pre správu prihlásenia (httpOnly refresh token). Nepoužívame analytické ani reklamné cookies.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[#E2D9F3] mb-2">7. Kontakt</h2>
            <p>V prípade otázok týkajúcich sa ochrany súkromia nás kontaktujte na emailovej adrese dostupnej cez aplikáciu.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
