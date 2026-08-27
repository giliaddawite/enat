# Verse dataset licensing — DRAFT

> **DRAFT — MAINTAINER MUST CONFIRM BEFORE LAUNCH.**
> Nothing in this document is legal advice, and none of its conclusions have been
> verified by the maintainer. Two launch gates from TICKET-106 remain open until a
> human closes them:
>
> 1. **Licensing confirmation** — decide which Amharic source Enat may legally ship.
> 2. **Text verification** — spot-check at least 10 entries of
>    `backend/src/data/verses.json` against a licensed source and flip their
>    `verified` flags to `true`.

## What the endpoint ships today

`GET /v1/verse/today` serves a 30-entry starter rotation checked in at
`backend/src/data/verses.json` (the ticket's full 365-entry list is filled in
once a licensed source is confirmed):

- **English text** is quoted from the **King James Version**, which is in the
  public domain in the United States (in the UK it remains under perpetual Crown
  letters patent, which restrict *printing in the UK*, not use in a US-hosted
  service for a US-based user).
- **Amharic text** is a **machine-drafted rendering in the style of the standard
  Amharic Bible. It was not copied from a verified digital source and must be
  treated as unverified draft text** until reviewed. Every entry carries
  `verified: false`; the maintainer flips the flag entry-by-entry after checking
  the wording against a source Enat is licensed to use.

## Research findings (2026-08-27, unverified)

### 1962 Haile Selassie I Version (the ticket's suggested source)

- No authoritative statement of its copyright status was found. Search results
  confirm the translation's history (the 1962 "Emperor's Bible", with a 1986
  revision of the New Testament) but not its licensing
  ([Wikisource statement on the Revised Amharic Bible](https://en.wikisource.org/wiki/Statement_on_the_Revised_Amharic_Bible),
  [Textus Receptus — Amharic Bible translations](http://textus-receptus.com/wiki/Bible_translations_(Amharic))).
- Reasoning to confirm, not rely on: under Ethiopia's copyright proclamation
  (No. 410/2004), economic rights in a work of a legal entity generally run 50
  years from publication, which would put a 1962 corporate publication in the
  Ethiopian public domain around 2012. **However**, because it was still
  protected in Ethiopia on the URAA restoration date (1996-01-01), its **US
  copyright was likely restored and would run ~95 years from publication (to
  roughly 2057)**. Enat's backend runs in the US, so the US status is the one
  that matters. Sites do redistribute this text (e.g. bible.org's "Haile
  Selassie Amharic Bible"), but redistribution by others is not a license.
- **Conclusion (draft): do not bulk-copy the 1962 HSV text without either a
  legal determination that it is usable or permission from the rights holder
  (the Bible Society of Ethiopia is the natural contact).**

### Openly licensed / public-domain machine-readable alternatives

- No clearly licensed, machine-readable Amharic Bible dataset was found.
  The open datasets checked ([midvash bible-data](https://midvash.github.io/bible-data/) — 33
  public-domain versions, none Amharic) do not cover Amharic.
- [unfoldingWord / Door43](https://door43.org/) publish scripture resources
  under **CC BY-SA 4.0** ([content page](https://unfoldingword.org/for-translators/content/))
  and have Amharic-language projects; completeness and quality of an Amharic
  Bible there were **not verified**. This is the most promising legally clean
  route for a full 365-entry dataset if its Amharic text is complete and
  acceptable to the maintainer. CC BY-SA requires attribution in the app.
- The first complete Amharic Bible (the **Abu Rumi translation**, printed 1840
  by the British and Foreign Bible Society) is unambiguously public domain
  everywhere, but survives digitally only as page scans and uses archaic
  Amharic ([Wikipedia: Abu Rumi](https://en.wikipedia.org/wiki/Abu_Rumi),
  [Bible translations into Amharic](https://en.wikipedia.org/wiki/Bible_translations_into_Amharic)).
  Not practical as a machine-readable source without an OCR/typing project.
- The **New Amharic Standard Version** and the Bible Society of Ethiopia's
  current editions are modern, actively licensed works — **not** usable without
  permission.

## Decision needed from the maintainer

1. Pick the Amharic source for the full 365-entry rotation:
   - request permission from the Bible Society of Ethiopia for the 1962 HSV, or
   - evaluate Door43/unfoldingWord's Amharic text (CC BY-SA 4.0, attribution
     required), or
   - another source of the maintainer's choosing.
2. Verify at least 10 entries of `backend/src/data/verses.json` against the
   chosen source (TICKET-106 acceptance criterion) and flip `verified: true`
   entry by entry as they pass.
3. Record the final licensing decision here and remove the DRAFT banner.
