# tether-server

Backend for Tether, a family caretaker app. A parent who is not comfortable with English phone work presses one button and speaks in Bengali, English, or a mix. The server transcribes, triages the request into one of four kinds, and, only for phone tasks and only after a named caregiver approves, runs a published CALL-E Goal that makes the English call and returns a structured result. The person the call concerns always sees the transcript and the result.

## Companion iOS app

The SwiftUI app (parent "one button" view, caregiver inbox with the approval gate, family finance blocks, Bengali read-back) lives in the main project repository: <https://github.com/fbablu/tether> under `ios/Tether`. It needs Xcode 26 and talks to this server over a private network. This directory is the runnable, testable core that reviewers can exercise without a phone.

## Why this exists

Immigrant parents can usually manage their money and health. What they cannot do is spend forty minutes on hold with a mortgage servicer in their second language. Today that work lands on one adult child by text message and voice note. Tether turns the voice note into a reviewable task, and CALL-E does the phone part.

## How it differs from the entries next to it

`speakeasy` and `call-on-behalf` make a call *for one person*. Tether is for a *family*: the person who speaks is not the person who approves, most requests never become a call at all (they are answered from the family's own records on device), and the person the call concerns can always see what was done in their name. Bengali/English code-switched speech is the input, which no other entry covers.

## What CALL-E does here

- `client.goals.runAndWait` executes the published "call a business on behalf of a family member" Goal with per-run variables (`on_behalf_of`, `caregiver_name`, `business_name`, `question`, `constraints`).
- `client.calls.createAndWait` is the one-shot fallback when no Goal id is configured, using the same result schema (`answer`, `details`, `human_required`, `next_steps`, `channel`, `reference_number`, `callback_needed`).
- Results are polled through the SDK, so no public webhook URL is needed and the server can live on a private network (Tailscale in our setup).

## Setup

```sh
pnpm install
cp .env.example .env      # stays in dry-run until you say otherwise
cp fixtures/contacts.example.json data/contacts.json   # the ONLY numbers that may be dialed
pnpm test                 # 7 tests, no network, no keys
pnpm demo                 # end-to-end dry run over two corpus lines
pnpm dev                  # http://localhost:8787
```

## Side effects and how to stay safe

- **Dry-run is the default.** Nothing dials until `TETHER_DRY_RUN=false` and `TETHER_CALLE_API_KEY` are set. In dry-run every endpoint behaves the same and returns a synthetic result.
- **A real run costs one CALL-E call** per approval. Idempotency keys are `tether:<requestId>:attempt-N`, so retrying the same approval does not dial twice.
- **Cancellation:** `POST /v1/requests/:id/cancel` before approval. Once a call is dialing it runs to completion (CALL-E has no mid-call cancel in this SDK version); nothing is recurring.
- **Credentials:** the CALL-E and Gemini keys live only in the server `.env`. The iOS app never holds them. There is no field anywhere for user passwords or logins.
- **Numbers:** the server dials only contacts in `data/contacts.json`, entered by the family. A number spoken into the mic is never dialed.
- **Text sent to models** has digit runs redacted first. The triage model sees slot names like `{{mom.checking.balance}}`, never values; the device fills them.

See `docs/SAFETY.md` for the full pattern.

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/v1/health` | anyone | dry-run flag, goal configured or fallback |
| GET | `/v1/health/gemini` | anyone | whether the Gemini key works |
| GET | `/v1/contacts` | anyone | allowlist with masked numbers |
| POST | `/v1/requests` | any member | JSON `{memberId, memberName, role, transcript?, catalog}` or multipart `meta` + `audio` (+ `hint`) |
| GET | `/v1/requests?memberId=` | member | caregivers see all; others see their own |
| GET | `/v1/requests/:id` | member | same visibility rule |
| POST | `/v1/requests/:id/approve` | caregiver only | `{by, contactId, question?, constraints?}` runs the Goal |
| POST | `/v1/requests/:id/consent` | the person the call concerns, or a caregiver | `{state: "given" \| "declined", answeredCorrectly?}` while awaiting approval |
| POST | `/v1/requests/:id/cancel` | member | before approval |

`/v1/requests/:id/consent` records that the person the call is about heard what would be asked and said yes or no: a decline cancels the request and makes approve return 409, and no consent at all still lets the caregiver approve, it just shows as waiting in the app.

`/v1/health/gemini` makes one cheap text call per distinct configured model (`TETHER_STT_MODEL` and `TETHER_TRIAGE_MODEL`, usually the same string, so usually one call) so you can tell a bad key from a bad network without opening `.env`. It is open like `/v1/health` and reports only the key's shape (`legacy_aiza`, `auth_key_aq`, `unknown`) and length, never any part of the key itself. Top-level `ok` is true only if every model answered. Results are cached for 30 seconds, so refreshing does not hammer Google; a cached response carries `cachedAt`. With no key set at all it returns `{"ok":false,"reason":"no_key"}`.

```
curl -s localhost:8787/v1/health/gemini
{"ok":true,"keyFormat":"auth_key_aq","keyLength":54,"models":{"gemini-3.8-flash":{"ok":true,"sample":"OK"}}}
{"ok":false,"keyFormat":"auth_key_aq","keyLength":54,"models":{"gemini-3.8-flash":{"ok":false,"httpStatus":401,"googleStatus":"UNAUTHENTICATED","reason":"ACCESS_TOKEN_TYPE_UNSUPPORTED"}}}
```

Identity is three headers on a private network: `x-tether-member`, `x-tether-role` (`caregiver`, `supporter`, `loved_one`), `x-tether-name`. Replace with real auth before a multi-family deployment.

## Speech-to-text

Apple's on-device recognizers do not support Bengali (checked on macOS 26.6: 63 legacy locales and 30 SpeechAnalyzer locales, none Bengali). Providers here:

- `gemini` (default for real use): `TETHER_STT_MODEL`, free tier.
- `whisper`: local whisper.cpp for a fully private path. Whisper large-v3 scores about 34% character error rate on Bengali FLEURS, so this is the privacy option, not the accuracy option.
- `fixture`: offline, uses `fixtures/corpus.json` for tests and demos.

`pnpm bakeoff corpus/clips/dad-setA gemini:gemini-3.8-flash,whisper` prints CER/WER per provider against the corpus ground truth.

## Verification

`pnpm test` covers: answer-from-data never contains a number, phone tasks wait for approval, loved ones cannot approve, non-allowlisted contacts are refused, dry-run completes with an audit trail, the person concerned can always read their own request, multipart audio reaches the transcriber. A live verification is opt-in: set `TETHER_DRY_RUN=false`, put your own number in `data/contacts.json`, approve one request.

### Early local-mode measurement

A synthesized Bengali corpus line (A14, macOS Piya voice) through whisper.cpp large-v3-turbo with `-l bn` came back as `"Insurance Company Cover"`: every Bengali word dropped, only the English loanwords survived. Synthetic audio is not a benchmark, but it matches the published 34% CER and is why local mode is labeled privacy, not accuracy. Real numbers from the family corpus go here after the bake-off.
