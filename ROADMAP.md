# PropSights — Launch Roadmap

What needs to be done before this is a live, public website.

---

## 1. Email capture (blocker)

The CTA form currently fakes a submission with a `setTimeout`. No emails are collected.

- Pick a provider: **Resend** (simplest, developer-friendly) or Mailchimp / ConvertKit
- Add an API route at `app/api/subscribe/route.ts` that POSTs the email to the provider
- Wire the form in `CTASection.tsx` to call that endpoint instead of the fake delay
- Add basic rate limiting so the endpoint can't be spammed

---

## 2. Vercel deployment

- Create a Vercel project, connect it to the GitHub repo
- Set the **Root Directory** to `artifacts/landing-next`
- Set the **Framework** to Next.js (Vercel auto-detects this)
- Confirm the first deploy succeeds and the preview URL is live
- Every push to `main` will auto-deploy from this point on

---

## 3. Custom domain

- Buy a domain (e.g. `propsights.com` or `propsights.io`)
- Add it in Vercel → Domains
- Vercel handles SSL automatically

---

## 4. Favicon & OG image

- Add a `favicon.ico` or SVG favicon to `artifacts/landing-next/app/`
- Design a 1200×630 OG image (used when the link is shared on WhatsApp, Twitter, LinkedIn)
- Add it to `public/og.png` and wire it into the `metadata` in `app/layout.tsx`
- Without this, social shares look broken

---

## 5. Privacy & Terms pages

- The footer links to `#` — those need real pages
- Minimum viable: a short Privacy Policy (what data you collect, why, how long you keep it) and Terms of Use
- Required for GDPR compliance given the EU/Cyprus audience
- Can be simple static pages at `app/privacy/page.tsx` and `app/terms/page.tsx`

---

## 6. Analytics

- Add **Vercel Analytics** — one import, free, no cookie banner needed
- Optional: add **Plausible** or **PostHog** if you want more detail
- At minimum you want to know how many people visit and how many submit the waitlist form

---

## 7. SEO basics

- Add `sitemap.xml` — Next.js can generate this automatically via `app/sitemap.ts`
- Add `robots.txt` via `app/robots.ts`
- Verify the site in Google Search Console once it's live

---

## 8. QA before go-live

- [ ] Test the full page on mobile (iPhone Safari, Android Chrome)
- [ ] Test the Leaflet map loads correctly — it's the most fragile component
- [ ] Test the email capture form end-to-end (submit a real email, confirm it arrives)
- [ ] Check all footer links resolve (Privacy, Terms)
- [ ] Run a Lighthouse audit — aim for 90+ on Performance and SEO

---

## 9. Cleanup (before or after launch)

- Remove `artifacts/landing/` (the old Vite version) — it's dead code now
- Remove `artifacts/mockup-sandbox/` if it's not being used

---

## Order of priority

1. Email capture → Vercel deploy → Domain → OG image → Privacy/Terms
2. Analytics, SEO, QA in parallel with the above
3. Cleanup last
