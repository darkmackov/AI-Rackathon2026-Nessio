# Application notifications

The shared notification system extends the existing Mantine UI (Q-W18). It does not change API models, business prerequisites, generated clients, clinical findings or deadline notices.

## Delivery and lifetime

- `AppNotifications` is mounted once, inside the application's Mantine and translation providers. It uses the official `@mantine/notifications` store, not a second application state store.
- Notifications float at the top centre without changing document flow. The close button is vertically centred on the right. Desktop shows three notifications; mobile shows one. The count control opens the remaining notifications in a scrollable overlay.
- All four severities are manually dismissed in this delivery. In particular, errors and warnings have no timeout. Error is red, warning orange, success green and information blue; each also has an icon and label.
- The service coalesces equal active IDs and records an occurrence count. At most nine distinct notifications plus an overflow summary are retained. The summary asks the user to review the current state and dismiss reviewed notifications before taking another action; it does not claim that technical messages are repeated inline.
- Dismissing an automatic polling failure suppresses that failure until recovery or a new explicit operation. A failed job is identified by its job ID. Changing identity or resetting the demo clears notifications. Nothing is stored in browser storage.
- The host follows the active modal through a DOM subscription (`useSyncExternalStore`), keeping close controls inside the modal's focus scope. It respects reduced motion. Form-submit warnings defer announcement to the focused field summary; technical errors are announced only by the toast, with a neutral local retry control where available.
- Dismissing a notification returns keyboard focus without scrolling the page or an open dialog, preserving the user's current reading position.

## Ownership

`src/notifications/notify.tsx` owns delivery and deduplication. Call its `notifyWarning`, `notifyError`, `notifySuccess` and `notifyInfo` functions from event handlers or operation callbacks, never during render. Give local notices a stable operation-specific ID. Do not mount another `Notifications` component.

`createQueryClient` owns HTTP query and mutation failures. Its global caches call `notifyApiError`; local consumers retain `QueryError` only for a retry control, without repeating the error message or producing another toast. A `QueryError` without a retry renders nothing. The same error object is delivered once. Expected missing handovers/MDT records/conclusions and aborted requests are not technical notifications. Mutations are never retried automatically.

Pending actions across the application use the shared Mantine-based `ActionButton` and `ActionIconButton`. Their text, icons, dimensions and variant colours stay unchanged; they never use Mantine's loading overlay or replace their contents with a spinner. `pendingControlProps` keeps native interaction locks and accessibility state separate from a business-disabled action's appearance. It also applies to pending form fields, menu items and dialog close controls. Mutations remain in the shared Query cache, identity switching stays blocked, and dialogs prevent duplicate submission and dismissal until the operation finishes.

The notification host observes the rendered `data-action-pending` markers through `useSyncExternalStore` and displays one passive floating progress status inside the current dialog's scope. This covers local UI operations, generated queries and mutations without a second state store or changing the page layout. Initial page loading and long-running job progress keep their existing designed states. Failed requests use the shared popup and preserve form values.

Unsupported-file warnings, download and clipboard failures, malformed question or draft results, route failures and application startup failures also use the shared popup. No technical error alert is embedded in page content, search results or an upload form. Field errors and focused validation summaries, clinical findings, source warnings and job status badges remain local. Route and startup failures retain navigation or retry controls outside the popup. Incomplete drafts retain a retry button; only a newly received incomplete result emits a warning, never reopening a historical result.

Jobs can fail inside HTTP 200 responses. `rememberJob`, `useIngestJob` and `useAskCase` detect newly observed terminal failures and call `notifyJobFailure`. Rendering a historical failed job retains its status badge but must not emit a new notification or an embedded error message. Raw `Job.error` is never displayed in the web UI.

## Validation and messages

`normalize-error.ts` recognizes the existing API error shapes and a controlled catalogue of real and demo reasons. Unknown server messages, exception text, rejected `input`, validation `ctx`, stack traces and proxy HTML are not displayed. Transport failures do not prove a database failure or prove that a write did not complete. After a lost response, inspect the current state before repeating a send.

`form-validation.ts` builds labelled summaries, emits one warning per invalid submit and maps known backend validation paths to form fields. Keep every invalid path, including row indexes. Do not deduplicate errors by message text. Validate on blur and submit, not on each keystroke. Blur does not emit toasts. Backend field errors preserve drafts and are shown beside the affected fields.

Do not add required clinical fields as part of notification work. Gaps still do not block the referring doctor's handover. Saving an incomplete conclusion remains distinct from confirming it. Business checks remain in their existing owners, not copied into frontend notification code.

## Verification and remaining boundary

Notification tests live in `src/test/notification-errors.test.ts`, `notification-forms.test.tsx`, `notification-mdt-fields.test.tsx`, `notification-jobs.test.tsx`, `notification-fallbacks.test.tsx` and `notifications.test.tsx`.

Run the web tests, build and lint. On resource-constrained machines use `npm --prefix apps/web test -- --maxWorkers=2`, without increasing test timeouts. Browser acceptance includes 320 px reflow, desktop, manual dismissal inside a modal, queue expansion, reduced motion and no content layout shift.

The backend still uses its existing string `detail` responses and FastAPI validation responses (APIM-6). Consequently, the web cannot manufacture stable codes, database-specific diagnoses or every simultaneous business prerequisite from a fail-fast response. A structured error contract, backend exception sanitization/log correlation and database outage integration tests require a separate backend change and its prescribed Python verification. This delivery does not claim those changes are implemented.
