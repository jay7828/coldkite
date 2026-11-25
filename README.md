# Coldkite

Paste a job post (text or a screenshot), get a short application email written from **your** profile, and send it from **your own** inbox, with your resume attached.

No sign-up, no database. Everything you enter stays in your browser.

## What it does

- **Job post tab.** Paste a post or drop a screenshot. Claude reads it, pulls out the role, company and the apply address, lists where you match and where you fall short, and drafts a 110–150 word email. You edit it, then send it.
- **Bulk tab.** Paste a list of `email, name, company` rows, write one template with `{{first_name}}` and `{{company}}`, preview each mail, and send them one at a time.
- Warns you before you email someone you've already emailed from this browser.

The AI only uses facts you put in your profile. It never guesses email addresses: if the post has none, it tells you how to apply instead.

## What you need

| Setting | Where to get it |
|---|---|
| Your name, profile, signature | You write them in Settings |
| Anthropic API key | [platform.claude.com](https://platform.claude.com/settings/keys). You pay Anthropic directly for what you use |
| **Gmail**: address + app password | Turn on 2-step verification, then [create an app password](https://myaccount.google.com/apppasswords). Gmail allows about 500 emails a day |
| **or Resend**: API key + From address | [resend.com](https://resend.com). Needs a verified domain |
| Resume PDF (optional) | Up to 2 MB |

## Where your data goes

- **Settings, resume, recipient lists, sent log:** `localStorage` in your browser. *Settings → Clear all data* deletes all of it.
- **Anthropic key:** sent straight from your browser to `api.anthropic.com`. It never touches the Coldkite server.
- **Gmail app password / Resend key:** browsers can't send email directly, so each send goes through a small serverless function (`app/api/send/route.ts`). The browser passes the credentials with that one request; the function sends the email and keeps nothing. It doesn't log or store them. If you'd rather not trust a hosted copy with them, run your own (below). It's one command.

## Run it yourself

```bash
git clone https://github.com/jay7828/coldkite.git
cd coldkite
npm install
npm run dev        # http://localhost:3000
```

No environment variables needed. To host your own copy, deploy to Vercel (`npx vercel deploy --prod`) or anywhere that runs Next.js.

## Stack

Next.js 16 (App Router), React 19, the Anthropic TypeScript SDK (called from the browser), Nodemailer for Gmail SMTP.

## License

MIT
