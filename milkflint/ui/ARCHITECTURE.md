# How a page is built

One way to read from the router, write to it, build a form and move between pages. Lint holds all of `src/` to it (`eslint.config.js`, the boundaries).

## Layers

```
src/router.ts       routes over the feature registry; the root is the sign-in gate and the shell
page.tsx, parts     components: useSuspenseQuery / useLive, mutation hooks, useSettingsForm, Link
queries.ts          the feature's query factories and mutation hooks
api.ts              async functions and the zod schemas of the replies (call / exec live here)
model.ts            the form schema, toForm, toChanges, pure derivations (node --test, no React)
lib/ubus.ts         the transport: calls in one tick go out as one request
```

A feature folder holds `feature.ts`, `api.ts`, `queries.ts`, `model.ts`, `page.tsx` and its parts.

Rules (lint):

- A `.tsx` file never imports `call`, `exec` or `callAnonymous`.
- `queryKey` is written only in `queries.ts` (and `src/lib/query/`).
- No `@/hooks/use-load`, `@/hooks/use-poll`, `@/lib/shared-call`.
- A component never reads `form.state` (it doesn't re-render): `form.Subscribe`, `useSelector(form.store, …)`, `useFormValues(form)`.
- No `window.location.hash =` or `hashchange` listener outside `src/lib/router.ts`: `<Link>` or `useNavigate()`.

## Reading

Three kinds of query (`src/lib/query/options.ts`):

| Kind                          | For                                       | Asks again                                                                 |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `settingsQuery(key, load)`    | settings a page edits                     | after a save, and on mount when over 5 s old; never on a timer or on focus |
| `liveQuery(key, load, every)` | what the router is doing now              | every `every` ms while the tab is visible, at once when it shows again     |
| `staticQuery(key, load)`      | what doesn't change while the router runs | once a session                                                             |

Keys are `[feature, resource, params?]`, lower case: `['upnp', 'settings']`, `['test-bench', 'member', id, 'status']`. A call made with another session (a test bench member's) has the member's id in its key, never the session.

- The data a page can't draw without: `useSuspenseQuery(x.settings())` inside `<PageBoundary>` (skeleton while loading, the load error with Try again when it fails). `data` is then always there.
- Live data that decorates a page: `useLive(x.status())`, which gives `data`, `error`, `loading`, `refresh`, and `at` / `next` for `Freshness`. `useRead(x.settings())` gives the same shape for a settings or static read the page can draw without.
- A page whose header carries controls (a power switch, a view toggle) may read with `useQuery` and its own loading and error branches rather than `PageBoundary`, so the header shows at once.
- Two pages reading the same thing use one key: the owning feature's factory, taking the reader's pace where they differ (`wgStatusQuery(10_000)`, `adguardQueries.status(30_000)`), or `sharedQueries` in `src/lib/query/shared.ts` when no feature owns it. Home's widgets read through `dashboard/queries.ts`.
- "Not in this firmware" is data (`null`), not an error.
- A `queryFn` calls api functions only, never another query's cache: calls made together are one request already.
- A factory states what it gives: `settings: (): RouterQuery<UpnpForm | null> => settingsQuery(['upnp', 'settings'], loadUpnp)`; a live one is a `LiveQuery<T>`.
- A read whose arguments depend on the last answer takes them as a function: the key says what's asked (`['lan', 'connections', asked]`), the function gives the call's arguments when it's made.
- Something worked out between two answers (a rate, a core's load) is kept in the component by `at`, the answer's time, so a re-render never counts one twice; the fetcher stays a plain read.

The cache is emptied when the session ends. Nothing retries, and nothing waits for the browser to say it's online: the router is often the network that just went away.

## Writing

- A UCI save is `useApply()`: `apply(changes)` stages and applies (the firewall with rollback and nft's check), one save at a time across the app, and refreshes every query before the next may start (waiting for them at most `REFRESH_WAIT_MS`, as a router out of reach just after a save mustn't hold it). `applyAndMove` for a save that moves the router.
- Any other write is a mutation hook in `queries.ts` (`useClearUpnpMappings()`) that invalidates the keys it changes. Its error is always shown.
- A mutation whose variables hold a secret (sign-in, a new password) sets `gcTime: 0`, so they aren't kept in the mutation cache.

## Forms

The schema is the source: `model.ts` has `xFormSchema` (zod, messages written out), `type XForm = z.infer<typeof xFormSchema>`, `toForm(saved)` and `toChanges(form, before)`. One message per field, the first rule it fails; cross-field and data-dependent rules in one `superRefine` with `path: [field]`; a schema that needs loaded data is a function, `xFormSchema(data)`. No transforms: a form holds what its controls hold (text boxes hold strings, as UCI does). Shared field rules (IPv4, MAC, port ranges) are in `src/lib/schemas.ts`, each taking its message. Model tests check a schema with `formErrors(schema, value)`.

`useSettingsForm({ schema, saved, onSave })` returns `{ form, dirty, invalid, save, discard }`. What the router sends back never overwrites a field being edited; a save that comes back leaves the form pristine, holding what the router stored (an empty box saved as its default shows the default). `onSave` returns `apply(...)`'s promise, so the form knows a failed save (the edits stay) and one with nothing to write (back to saved).

Fields come from `@/components/form`, each given the field TanStack Form's render prop hands it, typed by the value it binds:

```tsx
<form.Field name="enabled">{(field) => <SwitchField field={field} label="Automatic port opening" hint="…" />}</form.Field>
```

`TextField`, `SwitchField`, `NumberField`, `SelectField`, `SegmentedField`, and `FormField` for a bespoke control (its render prop hands the id and aria wiring to spread on the control). `layout="stacked"` in a sheet; `trim` on a text box for an address or a number. Errors show once a change or a save has validated the form; `showError={false}` keeps one back for now (a sheet's empty field isn't wrong yet).

A sheet's form is `useSheetForm({ schema, saved, submit })` (`src/lib/form/use-sheet-form.ts`): `saved` is what it opened with, Save calls `settings.save`, and `submit` applies and gives the failure's message, so the sheet closes once the save went through and keeps the failure on screen when it didn't (`useApply`'s `apply` resolves with how it ended; the firewall's actions have `submit` and `applyNow`).

A bespoke control that isn't a kit field (a row that sets several values, a card with its own layout) still keeps its state in the form: it reads `useFormValues(form)` and writes with `form.setFieldValue`, never a `useState` copy that a refetch could overwrite. A list in a form is `<form.Field name="rows" mode="array">` with `pushValue` and `removeValue`.

## Routes

Addresses live after `#`: `#/lan`, `#/lan/addresses`. `src/router.ts` has the routes: one page route, `/$`, whose splat is the address (the feature, then the sub-path a page reads for its tab), so a tab change never remounts the page; and `/test-bench/join/$`, outside the sign-in gate. An address that names no page shows Home. `useRoute()` and `useSubPath()` read the address; `<Link {...pageLink('lan', 'addresses')}>` links; `useNavigate()` moves from code. A feature's `prefetch(client)` in `feature.ts` (`client.query(xQueries.settings()).catch(() => undefined)`) starts its first read while its code loads, and on hovering a link to it; never while signed out, as the refusal would stay in the cache for after the sign-in. `addressLink('#/logs/radar')` reads an address kept as text back into link options.

## A page

```tsx
export function UpnpPage(): ReactElement {
  return (
    <>
      <PageHeader title="UPnP" description="…" />
      <PageBoundary>
        <UpnpBody />
      </PageBoundary>
    </>
  );
}

function UpnpBody(): ReactElement {
  const { data: saved } = useSuspenseQuery(upnpQueries.settings());
  const mappings = useLive(upnpQueries.mappings());
  if (saved === null) return <NotInFirmware />;
  return <UpnpSettings saved={saved} mappings={mappings.data} />;
}

function UpnpSettings({ saved, mappings }: { saved: UpnpForm; mappings: readonly Mapping[] | undefined }): ReactElement {
  const { state, apply } = useApply();
  const settings = useSettingsForm({ schema: upnpFormSchema, saved, onSave: (values) => apply(toChanges(values)) });
  const { form } = settings;
  return (
    <>
      <ApplyStatus state={state} />
      <form.Field name="enabled">{(field) => <SwitchField field={field} label="Automatic port opening" hint="…" />}</form.Field>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
```

## Tests

Model and schema tests run on `node --test` (`pnpm test`). Browser tests (`pnpm test:browser`) draw through `renderWithProviders` (`tests/browser/render.tsx`): a fresh query cache and router for each test.
