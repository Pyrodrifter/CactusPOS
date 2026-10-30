# Receipt visibility controls (REL09)

Owner requested logo-only branding because the company name is already in the logo, plus more editor toggles.

`DocumentDesign` adds default-true switches: `showBusinessName`, `showLogo`, `showAddress`, `showTitle`,
`showSubtitle`, `showOrderNumber`, `showDateTime`, `showTabName`, `showPaymentDetails`, `showPaymentReference`,
`showFooter`, `showClosingImage`, `showMessages`, `showCodes`. Existing phone/modifier/note switches remain.
`DesignMessage.enabled` and `DesignCode.enabled` are optional; absent means enabled.

- Hidden content is retained in the versioned design. Switch it back on without reuploading images or
  retyping messages, footer, lettering or WiFi codes. Business-name hiding suppresses both printer text and
  name lettering; uploaded logo is independent. Header presets choose logo+name, logo only or name only.
- Preview, HTML/browser printing and ESC/POS share the same block builder and honor the switches.
- Receipt order-number switch hides the extra large number and the duplicate ticket number; receipt number,
  amounts, CRIB (and ABB unless `showTax` is off), copy/void/unpaid/correction markers remain present. Kitchen routing number and preparation
  modifiers/notes remain visible; kitchen date/time, tab label and branding/extras are independently configurable.
- Disabling the footer suppresses the fallback business footer too. Turning off payment details hides the
  tender/change/tip rows together; reference switch hides only the card reference. Stored sale data is untouched.
- Defaults preserve output of older designs, including historical orders using their saved template version.
  Publishing creates a new version for new orders. No receipt number, payment, tax or business setting changes.

`showTax` (RCP10, owner request, default true) hides the ABB lines under the total on the guest receipt: the
"prices include ABB" line, each per-rate ABB row and the exempt / outside-scope rows. The total, the stored tax
breakdown, reports and Z reports are unchanged. Whether a receipt must show ABB is the business's own call.

Existing template preview/publish/restore routes and schemas carry these fields; no new route or DB migration.
