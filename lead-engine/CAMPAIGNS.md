# SOBE Lead Engine — campaign menu v2 (draft)

Every campaign is a draft until Jessie approves its blast, and a blast
is a draft until Jessie approves it *and* confirms the send. Nothing in
this file sends an email. Campaigns are built by the Campaign Writer
(see `CREW.md`) and built into blasts by the Blast Manager.

Language rules for every campaign, no exceptions:

- Never call Jessie or USA Energy Partners a "broker".
- Never promise savings.
- Call to action is always the free review: "Get a free review — no
  fee, no obligation." A campaign may link its live article on
  saveonbusinessenergy.com.
- Audience is always contacts where `unsubscribed = false`. Uploaded
  lists are `consent_status = 'unknown'` — they are in the repository,
  but the blast preview shows that status so Jessie can see it.

## (a) News-story campaigns

Trigger: a specific Texas energy news story breaks — an ERCOT change, a
grid event, a rate move, a data-center announcement, a rule change, a
provider failure. The Campaign Writer builds a campaign from THAT story,
and only from that story.

Required before the campaign is written (no exceptions):

- Headline, as reported.
- Source link (the publication, not a summary of a summary).
- Why it matters to a Texas business with a big power bill, in one or
  two sentences, tied to what the story actually says.

Template (fill in per story — do not reuse a previous story's details):

| Field | Example shape (fill in for real) |
|---|---|
| Name | "News: <short story label> — <week of …>" |
| Type | `news` |
| News story | Headline + source link, as reported |
| Angle | "This story means <concrete effect on a business bill or contract>. Here is what to check before your next contract decision." |
| Subject options | 1. "Texas energy news that affects your bill" 2. "<Story label>: what it means for your business" 3. "Before your next contract — read this first" |
| Audience filter | Cities affected by the story; tags if the story hits one category (e.g. data centers, manufacturers) |
| CTA | Free review — no fee, no obligation |
| Article to link | The live article closest to the story's topic, if one exists; otherwise none — do not invent an article |

What never happens: a news campaign is never written from a headline
Jessie did not point to or the Writer did not read, and a date, quote,
or number is never added from memory. If the story cannot be sourced,
the campaign stays unwritten and the Writer says so in the run report.

## (b) Pain-point campaigns

Trigger: Jessie picks a pain point, or the Campaign Writer proposes one
from the live articles. Each pain point below is seeded by a real live
article on saveonbusinessenergy.com — the article is the proof the
campaign points to, not a claim the campaign invents.

| # | Pain point | Live article (slug) | Audience filter | Subject options | Angle |
|---|---|---|---|---|---|
| 1 | Contract ending / rolling onto holdover rates | `contract-end-date-esi-id.html` + `renegotiating-value.html` | Tags: contract-ending; all deregulated cities | "Your contract end date is on your bill — here is where" / "Before your fixed term ends, check this" | Many businesses roll onto a much higher month-to-month rate after the fixed term. Find the end date and ESI ID on the bill, then get a free review before it rolls. |
| 2 | Summer bill spikes | `summer-bill-spikes.html` | All deregulated cities; tag: summer-spike | "Why Texas summer bills spike" / "Summer is when the bill tells the truth" | Heat drives demand, demand drives the bill. A free review shows what on the bill is usage and what is rate and charges. |
| 3 | Demand charges | `demand-charges.html` | Manufacturers, cold storage, large restaurants | "Demand charges, explained in plain English" / "One peak hour can set your demand charge" | Demand charges are set by a short peak, not by total use. The article explains the line; the review looks at your bill's version of it. |
| 4 | TDU charges you cannot shop | `tdu-charges.html` | All deregulated cities | "The TDU charge you cannot shop — and what you can" / "What is a TDU charge?" | TDU charges are not shoppable, but the rest of the bill is. Know which line is which before deciding anything. |
| 5 | Fixed vs variable vs indexed — wrong fit | `fixed-variable-indexed.html` | All deregulated cities | "Fixed, variable, or indexed: which fits your business?" / "The wrong rate shape costs more than the wrong rate" | The rate shape matters as much as the rate. The article lays out the three; the review looks at which shape your business is actually on. |
| 6 | REP went out of business | `rep-out-of-business.html` | All deregulated cities | "What happens if your provider goes out of business?" / "If your REP disappeared, read this" | A provider failure moves a business fast, with little warning. The article covers what happens; the review checks where the contract stands now. |
| 7 | Overpaying without knowing — renegotiating value | `renegotiating-value.html` | All deregulated cities | "The value of renegotiating — before you sign again" / "Renegotiating is not switching for the sake of it" | Renegotiation is a comparison, not a switch. The article covers the value; the review is the comparison. |
| 8 | Cannot read the bill | `reading-your-bill.html` | All deregulated cities | "How to read your commercial bill, line by line" / "Your bill, translated" | Most of the bill is charges, not usage. The article walks the lines; the review walks yours. |
| 9 | Power factor — the hidden line | `power-factor.html` | Manufacturers, cold storage | "Power factor: the hidden line on your bill" / "A line on your bill you may not know you have" | Power factor is a charge many businesses never notice. The article explains it; the review checks whether it is on your bill. |
| 10 | Choosing the wrong broker / partner | `choosing-a-broker.html` | All deregulated cities | "What to look for before you trust someone with your contract" / "How to choose who reviews your bill" | The article lists what to look for; the review is free, independent, and comes with no obligation. (Campaign copy never uses the word "broker" for Jessie / USA Energy Partners.) |
| 11 | ERCOT / the grid, in plain English | `ercot-plain-english.html` | All deregulated cities | "The ERCOT grid in plain English" / "Why the Texas grid works the way it does" | The grid sets the context every contract lives in. The article explains it; the review looks at your contract inside it. |
| 12 | How contracts work | `how-contracts-work.html` | All deregulated cities | "How commercial electricity contracts work" / "Before you sign, know what you are signing" | Contracts have more moving parts than the rate. The article covers them; the review reads yours. |
| 13 | Data centers and the grid | `data-centers.html` + `data-centers-grid.html` + `data-centers-rates.html` | Data-center / large-load contacts; tag: data-center | "What data centers mean for Texas business rates" / "Data centers are changing the grid — here is the plain version" | Data-center load is changing the Texas grid. The articles cover the effect; the review is for the businesses living with it. |
| 14 | Solar + storage — does it pencil out? | `solar-storage-business.html` | Large-roof / high-use businesses | "Solar and storage for a Texas business: does it pencil out?" / "Before solar, read your bill first" | Solar is a bill question before it is a roof question. The article covers the math; the review starts from the bill. |
| 15 | Texas energy in the future | `texas-energy-future.html` | All deregulated cities | "Texas energy in the future — what to watch" / "Where Texas energy is headed" | The market is moving; a contract signed for today's market may not fit tomorrow's. The article looks ahead; the review looks at now. |
| 16 | Locking a rate when demand is rising | `data-centers-rates-lock.html` | All deregulated cities | "Locking in a rate when demand is rising" / "When demand rises, timing matters" | Rising demand changes the timing of a rate decision. The article covers locking in; the review checks the timing on your contract. |

Each pain-point campaign in the database (`campaigns` table) carries:
`name`, `type = 'pain-point'`, `pain_point`, `article_slug` (the file
above), `subject_options` (pick from the two above, or write new ones in
the same voice), `body_draft`, `cta` (free review), `audience_filter`
(cities + tags from the table), and `status = 'draft'`.

## How a campaign becomes a megablast

1. Campaign Writer writes the campaign (draft) — news or pain-point.
2. Blast Manager builds the blast from it: audience count + 5-address
   preview + subject options + body draft. Blast status: `draft`.
3. Jessie reviews the preview on the hidden page and approves the blast
   (approved_by + approved_at). Approval arms it; it does not send it.
4. Sending needs a separate confirm (`confirm: true`) on an `approved`
   blast only (see `api/blasts.js`). Then Resend sends one email per
   recipient, each with its own unsubscribe link.
5. Unsubscribes are honoured immediately and excluded from every future
   audience by the query itself.
