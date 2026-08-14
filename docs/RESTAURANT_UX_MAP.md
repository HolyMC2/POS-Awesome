# Restaurant POS UI/UX Map

Status: Wave 0 interaction contract  
Applies to: `cafeteria-counter` and `restaurante-mesas` capability profiles  
Companion: `RESTAURANT_TABLES_SPEC.md`, `POS-WORLDCLASS-ROADMAP.md`

This map describes what the operator sees, what every action means, where it
lands, and how it is tested. It is the acceptance contract for the restaurant
surface; component structure is allowed to change without changing these
promises.

## 1. Operator roles and homes

| Role/task | Default home | Primary input | Never exposed by default |
|---|---|---|---|
| Counter cashier | Browse/menu | touch, scanner, keyboard | floor editing, table transfer |
| Waiter | Floor | touch | accounting/stock setup |
| Cashier settling tables | Floor or Cart | touch, keyboard | kitchen configuration |
| Restaurant supervisor | Floor | touch, keyboard | raw capability JSON |
| Floor-plan editor | Floor/Edit | pointer or touch drag | active order mutation |

The POS Profile selects the register experience. One tenant may operate a
counter register and a table-service register concurrently.

## 2. Main navigation model

The shell owns five task views: Browse, Offers, Coupons, Payment and Floor.
Cart remains the common transaction context. The capability profile determines
which dock tasks appear; components request named views through the typed bus.

| Operator intent | Destination | Required shell transition |
|---|---|---|
| Add products to an account | Browse | selector panel + `items` view + search focus |
| Inspect an account | Cart | invoice panel, preserving active table order |
| Charge an account | Payment | invoice validation first, then dialog/view |
| Return to room | Floor | selector panel + floor view |
| Cancel payment | Cart | invoice panel; no keyboard-opening browse detour |

## 3. Floor screen anatomy

Reading order:

1. transfer banner, only while choosing a destination;
2. floor switcher with occupied/total counts;
3. jump, refresh and labeled More menu;
4. named-tab rail;
5. state legend;
6. plan or list representation;
7. active-account detail strip/rail;
8. modal action sheet or jump pad.

### Persistent actions

| Action | Visibility | Result |
|---|---|---|
| Jump | always | explicit table/tab lookup; selection opens directly |
| Refresh | always | authoritative server snapshot |
| Plan/List | More | alternate rendering of the same order set |
| Fit room | More, plan only | whole-room fit or touch-safe pan |
| Edit floor | More | enters layout mode; disabled with no floors |

The floor name is never sacrificed to five unexplained toolbar icons. More-menu
items carry text, icon and current state.

## 4. Table visual language

| State | Visual | Tap result |
|---|---|---|
| Free | outline, secondary label | action sheet offering Open table |
| Occupied | filled tile | action sheet for its account |
| Multiple accounts | occupied + aggregate tile state | account chooser; never aggregate Charge |
| Kitchen pending | red count | same action sheet; count is informational |
| Needs cleaning | broom/warning | Mark clean only while unoccupied |
| Syncing | progress/ring | mutation remains visible; repeat action prevented |
| Transfer target | free-table target treatment | moves selected account here |

Minimum table target is 44×44 CSS pixels. When authored geometry cannot fit at
that size, the room pans instead of shrinking into unsafe targets.

## 5. Table action sheet

### Free and clean

```text
Free table → Open table → create/resume account → Browse
Dirty free table → Mark clean → remain on Floor
```

Opening is explicit. Merely tapping a tile never creates an order.

### One open account

| Account state | Actions, in order |
|---|---|
| Empty | Add items, View order |
| Has lines | Add items, View order, Charge |
| Has unsent lines | same actions; View carries pending count |
| Settling | blocked by store/server with recoverable waiting message |

Charge never appears for an empty account. View lands on Cart; Add items lands
on Browse; Charge hydrates the account and invokes the cart's existing payment
validator.

### Multiple open accounts

The sheet displays one row per account with its name/short ID, own total, line
count and kitchen-pending badge. The operator must choose the exact account.
The combined table total is not displayed beside an action that can settle only
one account. Selecting an account hydrates it and lands on Cart, where Add items
and Charge remain available.

## 6. Active account panel

Shown as a side rail when the selector panel is at least 640px wide and as a
strip below the floor on narrow panels.

It displays:

- account/table identity;
- own total and line count;
- guest count;
- waiter local identity;
- idle age;
- kitchen-pending state.

Primary row: Add items, Charge.  
Management row: Send to kitchen, Move, Release empty table.

Release flushes cart synchronization and rechecks emptiness before cancellation.
Send remains available at an apparent zero pending count because the last cart
edit may still be inside the sync debounce.

## 7. Named tabs

Named tabs are for counter/cafeteria accounts without a physical table. Each
row identifies the account and resumes the exact server order. New tab opens
the jump pad name flow. A named tab never participates in floor occupancy.

## 8. Kitchen flow

```text
Add/edit lines → cart sync → Send to kitchen → durable station jobs
→ pending count clears → later edits create a new delta
```

- Send freezes only the current unfired delta.
- A retry with the same request ID is idempotent.
- Printing failure does not erase the kitchen job.
- Void/re-fire authorization and station diagnostics remain supervisor tasks.
- “Sent” means durable server projection/job, not guaranteed paper output.

## 9. Transfer, split and settlement

### Transfer

Move enters a modal target-selection state. The banner names the selected
account; free tables become targets; Escape/Cancel exits without mutation.
The source and destination are repainted from the authoritative snapshot.

### Multiple/split accounts

The floor supports multiple orders on one table but never silently chooses the
oldest after an explicit account decision. Wave 0 guarantees account selection.
Full split/merge by item, seat, quantity and amount remains a restaurant-beta
exit gate in the world-class roadmap.

### Charge

Charge never submits money from the floor. It hydrates the exact account and
delegates to Invoice/Payment validation. Payment success settles the table
order, materializes the ERP document, marks cleaning state and clears the active
cart. Queued/offline settlement must show that intent is pending—not paid.

## 10. Empty, loading and failure states

| Condition | Operator message/action |
|---|---|
| No floors | register setup instruction |
| Empty floor | edit-plan call to action |
| No occupied tables | instruction to tap a free table |
| No named tabs | instruction to start a named account |
| Snapshot error | persistent alert plus Refresh |
| Write in flight | local syncing state on affected table |
| Settling offline | account remains identifiable and blocked from duplicate settle |
| Realtime disconnected | pull on reconnect/visibility; socket is only a hint |

Errors state what was preserved and the next safe action. They do not expose raw
tracebacks or imply success.

## 11. Responsive contract

| Panel width/input | Layout |
|---|---|
| Narrow phone | full selector width, pan-safe floor, account strip, bottom dock |
| Tablet/compact desktop | floor plus strip or rail based on measured panel width |
| Wide selector ≥640px | floor beside 248px account rail |
| Keyboard/scanner | native focus inside forms/overlays; named shortcuts outside |
| Coarse pointer | primary targets ≥44px; action rows 48px |

Breakpoints use the measured POS panel, not window width. A desktop window can
still give the selector only a narrow column.

## 12. Accessibility and language

- First-party screen flow targets WCAG 2.2 AA.
- Every icon-only toolbar action has accessible name and title.
- State is not encoded by color alone: fill/outline, words, badges and icons
  reinforce it.
- Focus remains visible; overlay and native form Tab behavior is preserved.
- Spanish is the certified operator language; translation keys avoid ambiguous
  reuse such as `Free` meaning both gratis and libre.
- Currency, counts and ages remain readable at zoom and in compact layouts.

## 13. Offline contract

- Floor/order snapshots are cached per register/device.
- A device may continue its own table account under the declared queue policy.
- Cross-device offline collaboration is not claimed.
- Queued edits carry stable request IDs and contract/profile scope.
- Cash/payment status is never inferred from a queued table mutation.
- Reconnect pulls authoritative state; conflicts become visible supervisor work.

## 14. Verification matrix

| Layer | Required proof |
|---|---|
| Pure/component | state/action offers, geometry, touch targets, clock, account selection |
| Shell contract | tile asks first; Add/View/Charge destinations; exact split account |
| Live Frappe | snapshot SQL, empty unsent, scope, order mutation, realtime, settle |
| Playwright phone | floor → open → add → send → charge; no clipping/mystery action |
| Playwright desktop | floor + rail, account resume, transfer, payment handoff |
| Offline browser | own-account edit/queue/reconnect; no false paid state |
| Soak | repeated service cycles without listener, DOM or memory growth |

No certification job may treat an all-skipped restaurant integration module as
green. Final E2E runs only after the exact built bundle is synchronized to the
declared lab site and its hash/version is verified.
