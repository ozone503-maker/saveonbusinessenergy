# For Gavin — what we built: the SOBE Lead Engine

Gavin,

Jessie and I built a lead engine for Save on Business Energy. It lives on a hidden page on the site:

saveonbusinessenergy.com/leads

That page is unlisted — no link to it from anywhere public, and search engines are told not to index it. The address itself is the only protection. You join later; for now it's Jessie and me running it.

## What it does

It finds Texas businesses that pay a serious power bill, and the person who pays it — and it builds one giant email list from all of it.

The goal is 200 new email addresses a day, minimum.

Leads get in three ways:
1. Hunting — ERCOT queue and data-center projects, Texas permits, Google Maps + Comptroller lists (cold storage, manufacturing, hotels, hospitals, big-box retail, dealerships, laundromats, big restaurants).
2. Uploads — someone hands us a whole mailing list (say Jose the electrician gives us his list), we upload the CSV and the agent dedupes it, aggregates it, and labels every row with who gave it to us.
3. Route Scout — one agent whose only job is finding new creative ways to get leads. Even 20 or 30 new addresses counts, and it adds up.

Every lead is sourced — business, decision-maker, a way to reach them, where we found it, and why they're a fit right now. Nothing is invented. If a contact can't be sourced, it goes in as no-contact-yet, never guessed. Same business is never listed twice. Deregulated Texas only — Houston, Dallas–Fort Worth, Corpus Christi. Austin and San Antonio are out.

## What the list is for

Weekly megablasts. The email list lives in one database (Postgres) and the blast builder pulls from it. Every blast is a draft first — you see the preview and the recipient count, then approve it, then confirm to send. Nothing sends without Jessie approving it first. Unsubscribed addresses are always excluded, and every email carries an unsubscribe link.

There are also campaign options built around news stories and around pain points — contract ending, summer bill spikes, demand charges, TDU charges, fixed vs. variable, a rep going out of business, and the rest of the articles already on the site.

## What you do on the page (when you join)

Big clear buttons across the top: Send email, Craft campaign, Import new list, Sort by keyword, Find new leads, Reprogram agent, Today vs 200.

- Approve or reject leads.
- Approve blasts before they go out.
- Leave directions in "Tell the agent" — the next run reads them first.
- Paste a big chunk of instructions in "Reprogram agent" and the maintenance bot rebuilds that agent inside the site, no code deploy.

There are multiple agents under one main agent: Hunter, Ingestor, Enricher, Campaign Writer, Blast Manager, Route Scout, and the Maintenance Bot that reprograms on the spot.

## What it is not

This is separate from ERBOT. ERBOT calls still come straight to your email when a caller consents — that hasn't changed.

The lead engine finds and lists only. It does not email, call, or DM a prospect unless Jessie says go on that exact outreach.

## Status right now

The page is live at the address above and looks like the rest of the site. The database isn't provisioned yet, so there are no leads in it yet and the API calls on the page will fail until Postgres is set up and the schema is run once. After that, the first runs start filling it toward 200 a day.

— Jessie
