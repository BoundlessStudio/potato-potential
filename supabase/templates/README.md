# Authentication email design

`sign-in.html` is the production design for both **Magic link or OTP** and **Confirm sign up** in Supabase Authentication → Emails. Passwordless sign-in uses the confirmation template for a new account and the magic-link template for an existing one.

Use the subject **Your sign-in link to Potato Potential** for both templates. Paste the complete HTML into each template's Source editor and save. The design retains Supabase's `{{ .ConfirmationURL }}` in the button and fallback link, and `{{ .Email }}` in the footer. Keep the native verification URL, token expiry and existing PKCE callback behavior.

The email uses the transparent wordmark, a white background, black text, a light purple (`#9574ED`) sign-in button, and light-only color-scheme hints. Fluid presentation tables, inline styles, an Outlook desktop width fallback, and a text link alongside the button support different email clients. Its public logo asset must be deployed before saving the template:

`https://potato-potential.rgbknights.com/brand/potato-potential-wordmark.png`

To manage these same templates through the Supabase Management API, update only `mailer_subjects_magic_link`, `mailer_templates_magic_link_content`, `mailer_subjects_confirmation`, and `mailer_templates_confirmation_content`. SMTP credentials and authentication rules do not need changes.

Reference: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
