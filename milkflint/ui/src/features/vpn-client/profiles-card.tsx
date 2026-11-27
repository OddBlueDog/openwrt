// The VPN page's profiles: named sets of its settings ("USA", "France"), one
// of them active, which is what runs. Each row says what it holds. Another
// profile switches in with Activate, behind a confirm that says what
// changes; it's edited in a sheet with the page's own cards, renamed or
// deleted. The active one's settings are the page's, so its Edit goes there.
// New saves a copy of the settings running now, or a blank profile to fill
// in from a provider's config.
import { BookmarkPlusIcon, InfoIcon, PlusIcon, SaveIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { type ReactElement, type ReactNode, type SyntheticEvent, useEffect, useId, useRef, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { EditorSheet } from '@/components/editor-sheet';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { ChoiceCards } from '@/components/page-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Change } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import { ClientFormCards, ConfigButton, ImportDialog } from './form-cards';
import {
  activeDnsOf,
  addressesOf,
  blankForm,
  type ClientData,
  type ClientForm,
  directText,
  readConf,
  serverNeedsFixing,
  serverText,
  clientErrors,
  whoSummary,
} from './model';
import {
  copyLiveChanges,
  createChanges,
  deleteChanges,
  differs,
  formOf,
  macsOf,
  nameError,
  needsServer,
  newProfileId,
  pointedId,
  type Profile,
  type ProfileForm,
  profileSummary,
  renameChanges,
  updateChanges,
} from './profiles';

const GUARD = 'Save or discard your changes on this page first.';

/** What a field is called in "Fix … to activate it", by clientErrors()'s key. */
const FIELDS: Partial<Record<string, string>> = {
  private: 'its private key',
  public: 'the server’s public key',
  psk: 'its preshared key',
  host: 'its server',
  port: 'its port',
  addresses: 'its addresses',
  mtu: 'its MTU',
  keepalive: 'its keepalive',
  dns: 'its DNS servers',
  macs: 'its devices',
  who: 'who uses it',
  shaper: 'its Smart Queue rates',
  direct: 'its sites that go direct',
};

/** Why a profile can't be activated yet: 'server' when it has none, else what to fix; undefined when it can. */
function blocker(p: Profile, d: ClientData): string | undefined {
  if (needsServer(p)) return 'server';
  const first = Object.keys(clientErrors({ ...p.form, enabled: true }, d))[0];
  return first === undefined ? undefined : (FIELDS[first] ?? 'its settings');
}

const isBlank = (f: Pick<ClientForm, 'privateKey' | 'publicKey'>): boolean => f.privateKey === '' && f.publicKey === '';

// ---- the switch, in words ----

interface Line {
  label: string;
  to: string;
  /** what it is now, when that differs */
  from?: string | undefined;
  mono?: boolean;
}

const dnsText = (f: ClientForm): string =>
  f.useVpnDns && activeDnsOf(f).length > 0 ? `The VPN’s (${activeDnsOf(f).join(', ')})` : 'This router’s';
const queueText = (f: ClientForm): string => (f.shaper ? `${f.downMbit} down, ${f.upMbit} up, Mbit/s` : 'Off');
const directLine = (f: ClientForm): string => (f.direct.length === 0 ? 'None' : directText([...f.direct].sort()));
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** What changes from what runs (`live`, undefined while it's off) to the profile: the parts that differ, or all of them. */
function switchLines(live: ClientForm | undefined, target: ClientForm, d: ClientData): Line[] {
  const parts: { label: string; text: (f: ClientForm) => string; mono?: boolean; hidden?: (a: ClientForm) => string }[] = [
    {
      label: 'Server',
      text: serverText,
      mono: true,
      // the same address, but another account at it
      hidden: (a) =>
        a.publicKey !== target.publicKey || a.privateKey !== target.privateKey || !sameList(addressesOf(a), addressesOf(target))
          ? ' (new keys)'
          : '',
    },
    {
      label: 'Goes through it',
      text: (f) => whoSummary(f, d),
      hidden: (a) => (sameList(macsOf(a), macsOf(target)) ? '' : ' (other devices)'),
    },
    { label: 'Kill switch', text: (f) => (f.killSwitch ? 'On' : 'Off') },
    { label: 'DNS', text: dnsText },
    ...(d.sqm ? [{ label: 'Smart Queue in the tunnel', text: queueText }] : []),
    ...(d.nftset === true ? [{ label: 'Sites that go direct', text: directLine }] : []),
  ];
  return parts.flatMap(({ label, text, mono, hidden }) => {
    const to = text(target);
    const line = { label, to, ...(mono === true ? { mono } : {}) };
    if (live === undefined) return [line];
    const from = text(live);
    if (from !== to) return [{ ...line, from }];
    const more = hidden?.(live) ?? '';
    return more === '' ? [] : [{ ...line, to: `${to}${more}` }];
  });
}

function ActivateDialog({
  profile,
  data,
  busy,
  onActivate,
  onClose,
}: {
  profile: Profile;
  data: ClientData;
  busy: boolean;
  onActivate: () => void;
  onClose: () => void;
}): ReactElement {
  const live = data.exists ? data.form : undefined;
  const on = live?.enabled === true;
  const lines = switchLines(on ? live : undefined, { ...profile.form, enabled: true }, data);
  const active = data.profiles.find((p) => p.id === data.active);
  const unsaved = active === undefined && live !== undefined && !isBlank(live);
  const drifted = active !== undefined && differs(active, data.form, data);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch the VPN to {profile.name}?</DialogTitle>
          <DialogDescription>
            {on
              ? `It takes ${profile.name}’s settings, and its devices reconnect through its server within a few seconds.`
              : `This turns the VPN on with ${profile.name}’s settings.`}
          </DialogDescription>
        </DialogHeader>
        {lines.length === 0 ? (
          <p className="text-sm">Its settings are the same as the ones running now.</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
            {lines.map((l) => (
              <div key={l.label} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-muted-foreground">{l.label}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">
                  <span className={cn('font-medium', l.mono === true && 'font-mono text-xs')}>{l.to}</span>
                  {l.from !== undefined && (
                    <span className="block text-xs text-muted-foreground">
                      Now: <span className={cn(l.mono === true && 'font-mono')}>{l.from}</span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {unsaved && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            The settings running now aren’t saved as a profile, so this replaces them. To keep them, cancel and save them as a
            profile first.
          </Note>
        )}
        {drifted && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {active.name} was changed outside this page, and this replaces those changes. To keep them, cancel and use “Save to{' '}
            {active.name}” first.
          </Note>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onActivate}>
            Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A profile's name, asked for: New profile (with where it starts from),
 * Rename, and the page's "Save these settings as a profile".
 */
export function ProfileNameDialog({
  title,
  description,
  action,
  initial = '',
  profiles,
  self,
  start,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  description: ReactNode;
  /** the button that saves */
  action: string;
  initial?: string;
  profiles: readonly Profile[];
  /** the profile being renamed: its own name stays allowed */
  self?: string;
  /** offer where it starts from; `live`: there are settings running to copy */
  start?: { live: boolean };
  busy: boolean;
  onSave: (name: string, from: 'live' | 'blank') => void;
  onClose: () => void;
}): ReactElement {
  const id = useId();
  const [name, setName] = useState(initial);
  const [from, setFrom] = useState<'live' | 'blank'>(start?.live === false ? 'blank' : 'live');
  const error = nameError(name, profiles, self);
  const unchanged = self !== undefined && name.trim() === initial;
  const ok = error === undefined && !unchanged && !busy;
  const submit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (ok) onSave(name.trim(), from);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field
            id={`${id}-name`}
            label="Name"
            hint="What this page calls it, like “France” or “Work”."
            // a name not typed yet isn't an error, only not done
            error={name.trim() === '' ? undefined : error}
            className="py-0"
          >
            <Input
              id={`${id}-name`}
              value={name}
              autoComplete="off"
              aria-invalid={name.trim() !== '' && error !== undefined}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </Field>
          {start?.live === true && (
            <ChoiceCards
              label="Start from"
              value={from}
              onChange={setFrom}
              options={[
                {
                  value: 'live',
                  label: 'The settings running now',
                  hint: 'A copy of what the VPN runs, to change in Edit.',
                },
                {
                  value: 'blank',
                  label: 'A blank profile',
                  hint: 'You add its server next, from your provider’s config.',
                },
              ]}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  profile,
  busy,
  onDelete,
  onClose,
}: {
  profile: Profile;
  busy: boolean;
  onDelete: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {profile.name}?</DialogTitle>
          <DialogDescription>Its saved settings and keys go. The VPN running now isn’t touched.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An inactive profile's settings, in the page's own cards; saving writes only the profile. */
function ProfileSheet({
  profile,
  data,
  busy,
  onSave,
  onClose,
}: {
  profile: Profile;
  data: ClientData;
  busy: boolean;
  onSave: (f: ProfileForm) => void;
  onClose: () => void;
}): ReactElement {
  // off: a profile still being filled in isn't marked wrong all over, as a tunnel that's off isn't
  const [form, setForm] = useState<ClientForm>({ ...profile.form, enabled: false });
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>();
  const [details, setDetails] = useState(false);
  const errors = clientErrors(form, data);
  const changed = updateChanges(profile, formOf(form)).length > 0;
  const blank = isBlank(form);
  const block = blocker({ ...profile, form: formOf(form) }, data);
  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
  };
  return (
    <EditorSheet
      title={`Edit ${profile.name}`}
      description={`Changes here take effect when you activate ${profile.name}.`}
      status={
        block === undefined ? undefined : (
          <p className="text-xs text-muted-foreground">
            {block === 'server' ? 'Add its server before activating it.' : `Fix ${block} before activating it.`}
          </p>
        )
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!changed || busy}
            onClick={() => {
              onSave(formOf(form));
            }}
          >
            Save
          </Button>
        </>
      }
      onClose={onClose}
    >
      <div className="flex min-h-full flex-col gap-4 bg-background p-4 sm:p-6">
        <ClientFormCards
          form={form}
          set={set}
          errors={errors}
          data={data}
          mode="profile"
          live={{
            blank: false,
            details,
            onToggleDetails: () => {
              setDetails((d) => !(d || serverNeedsFixing(errors)));
            },
          }}
          importButton={
            <ConfigButton
              blank={blank}
              onClick={() => {
                setImporting(true);
              }}
            />
          }
          imported={imported}
        />
      </div>
      <ImportDialog
        open={importing}
        onClose={() => {
          setImporting(false);
        }}
        onUse={(text) => {
          const read = readConf(form, text);
          if ('error' in read) return read.error;
          setForm({ ...read.form, enabled: false });
          setImported(read.notes);
          // what it read in, to check before saving
          setDetails(true);
          return undefined;
        }}
      />
    </EditorSheet>
  );
}

/** A row of the list: name and badge, what it holds, notes, and its buttons (a profile's, or the settings running now). */
function RowFrame({
  name,
  nameId,
  label,
  badge,
  summary,
  notes,
  actions,
}: {
  name: string;
  nameId?: string;
  /** for a row without its own heading id */
  label?: string;
  badge?: ReactNode;
  summary: string;
  notes?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <li
      {...(label === undefined ? { 'aria-labelledby': nameId } : { 'aria-label': label })}
      className="flex flex-col gap-3 px-5 py-4 @min-[34rem]:flex-row @min-[34rem]:items-start @min-[34rem]:justify-between @min-[34rem]:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={nameId} className="text-sm font-semibold [overflow-wrap:anywhere]">
            {name}
          </h3>
          {badge}
        </div>
        <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">{summary}</p>
        {notes}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </li>
  );
}

/** One profile's row: its name, the Active badge, what it holds, and what can be done with it. */
function ProfileRow({
  profile,
  data,
  dirty,
  busy,
  guardId,
  onActivate,
  onEdit,
  onRename,
  onDelete,
  onSaveTo,
}: {
  profile: Profile;
  data: ClientData;
  dirty: boolean;
  busy: boolean;
  guardId: string;
  onActivate: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSaveTo: () => void;
}): ReactElement {
  const id = useId();
  const active = profile.id === data.active;
  const block = active ? undefined : blocker(profile, data);
  const drifted = active && data.exists && differs(profile, data.form, data);
  const name = profile.name;
  return (
    <RowFrame
      name={name}
      nameId={`${id}-name`}
      badge={
        active && (
          <Badge variant={data.form.enabled ? 'success' : 'secondary'}>{data.form.enabled ? 'Active' : 'Active, VPN off'}</Badge>
        )
      }
      summary={profileSummary(profile, data)}
      notes={
        <>
          {block !== undefined && (
            <p id={`${id}-why`} className="text-xs text-muted-foreground">
              {block === 'server' ? 'Add its server in Edit to activate it.' : `Fix ${block} in Edit to activate it.`}
            </p>
          )}
          {active && (
            <p className="text-xs text-muted-foreground">Activate another profile, or remove the VPN, to delete this one.</p>
          )}
          {drifted && (
            <Note tone="warning" icon={<TriangleAlertIcon />} title="Changed outside this page" className="mt-2">
              <p>What runs now was edited in LuCI or on another page, so it isn’t what {name} holds.</p>
              <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={onSaveTo}>
                <SaveIcon />
                Save to {name}
              </Button>
            </Note>
          )}
        </>
      }
      actions={
        <>
          {!active && (
            <Button
              size="sm"
              aria-label={`Activate ${name}`}
              aria-describedby={dirty ? guardId : block === undefined ? undefined : `${id}-why`}
              disabled={dirty || busy || block !== undefined}
              onClick={onActivate}
            >
              Activate
            </Button>
          )}
          <Button variant="outline" size="sm" aria-label={`Edit ${name}`} onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Rename ${name}`} disabled={busy} onClick={onRename}>
            Rename
          </Button>
          {!active && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${name}`}
              aria-describedby={dirty ? guardId : undefined}
              className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
              disabled={dirty || busy}
              onClick={onDelete}
            >
              <Trash2Icon />
              Delete
            </Button>
          )}
        </>
      }
    />
  );
}

/**
 * The Profiles card, above the page's settings: shown once the tunnel is set
 * up or a profile exists. `onApply` is for changes to the profiles alone
 * (the page keeps its unsaved edits); Activate and Go back go through the
 * page, which renews the tunnel and watches it answer.
 */
export function ProfilesCard({
  data,
  dirty,
  busy,
  unanswered,
  onApply,
  onActivate,
  onGoBack,
  onEditActive,
  onSaveAs,
}: {
  data: ClientData;
  dirty: boolean;
  busy: boolean;
  /** an Activate whose server hasn't answered in 30 s, and the profile active before it */
  unanswered: { profile: Profile; previous: Profile | undefined } | undefined;
  /** `then` runs once the changes are applied (not when they fail) */
  onApply: (changes: Change[], note: string, then?: () => void) => void;
  onActivate: (p: Profile) => void;
  onGoBack: (p: Profile) => void;
  onEditActive: () => void;
  onSaveAs: () => void;
}): ReactElement {
  const guardId = useId();
  const card = useRef<HTMLDivElement>(null);
  // an apply that takes away the button that was clicked: focus goes to the card, not nowhere
  const refocus = useRef(false);
  const [activating, setActivating] = useState<Profile>();
  const [editing, setEditing] = useState<string>();
  const [renaming, setRenaming] = useState<Profile>();
  const [deleting, setDeleting] = useState<Profile>();
  const [creating, setCreating] = useState(false);
  const profiles = data.profiles;
  const active = profiles.find((p) => p.id === data.active);
  const live = data.exists && !isBlank(data.form) ? data.form : undefined;
  // a profile that was just made blank opens once it's there
  const sheet = profiles.find((p) => p.id === editing);
  const changeKey = `${data.active ?? ''}|${profiles.map((p) => p.id).join(',')}`;
  // what the card held when the apply began: an apply that changed nothing failed, and its refocus is dropped
  const keyAtStart = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (busy) {
      keyAtStart.current ??= changeKey;
      return;
    }
    const failed = keyAtStart.current === changeKey;
    keyAtStart.current = undefined;
    if (!refocus.current) return;
    refocus.current = false;
    if (!failed) card.current?.focus({ preventScroll: true });
  }, [changeKey, busy]);

  const description =
    profiles.length === 0
      ? 'Save these settings under a name, like “USA”, and make others, like “France”, to switch between.'
      : active === undefined
        ? 'Activate one to switch the VPN to its settings.'
        : 'One is active at a time. Its settings are the ones on this page, and saving them updates it.';

  return (
    <Card ref={card} tabIndex={-1} aria-label="Profiles" className="pb-0 outline-none">
      <CardHeading
        title="Profiles"
        description={description}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={dirty || busy}
            aria-describedby={dirty ? guardId : undefined}
            onClick={() => {
              setCreating(true);
            }}
          >
            <PlusIcon />
            New profile
          </Button>
        }
      />
      {/* always there, so a note that turns up in it is announced */}
      <div role="status">
        {unanswered !== undefined && (
          <CardContent>
            <Note
              tone="warning"
              icon={<TriangleAlertIcon />}
              title={`${unanswered.profile.name} is set, but its server hasn’t answered yet.`}
            >
              <p>
                {unanswered.profile.form.killSwitch
                  ? 'With the kill switch on, its devices have no internet meanwhile.'
                  : 'Its devices go out directly meanwhile.'}{' '}
                Check its server and keys below.
              </p>
              {unanswered.previous !== undefined && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={busy || dirty}
                  aria-describedby={dirty ? guardId : undefined}
                  onClick={() => {
                    if (unanswered.previous === undefined) return;
                    refocus.current = true;
                    onGoBack(unanswered.previous);
                  }}
                >
                  <Undo2Icon />
                  Go back to {unanswered.previous.name}
                </Button>
              )}
            </Note>
          </CardContent>
        )}
      </div>
      {dirty && (
        <CardContent>
          <Note tone="info" icon={<InfoIcon />}>
            <span id={guardId}>{GUARD}</span>
          </Note>
        </CardContent>
      )}
      <div className="@container">
        {/* Safari drops a list's role when its markers are off, so say it */}
        {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
        <ul role="list" className="divide-y border-t">
          {active === undefined && live !== undefined && (
            <RowFrame
              name="The settings running now"
              label="The settings running now"
              badge={<Badge variant="secondary">Not a profile</Badge>}
              summary={profileSummary({ id: '', name: '', form: formOf(live) }, data)}
              notes={
                <p className="text-xs text-muted-foreground">
                  {profiles.length === 0
                    ? 'Give them a name to come back to them after trying another server.'
                    : 'Activating a profile replaces them, unless you save them as one first.'}
                </p>
              }
              actions={
                dirty ? undefined : (
                  <Button variant="outline" size="sm" disabled={busy} onClick={onSaveAs}>
                    <BookmarkPlusIcon />
                    Save these settings as a profile
                  </Button>
                )
              }
            />
          )}
          {profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              data={data}
              dirty={dirty}
              busy={busy}
              guardId={guardId}
              onActivate={() => {
                setActivating(p);
              }}
              onEdit={() => {
                if (p.id === data.active) onEditActive();
                else setEditing(p.id);
              }}
              onRename={() => {
                setRenaming(p);
              }}
              onDelete={() => {
                setDeleting(p);
              }}
              onSaveTo={() => {
                onApply(updateChanges(p, formOf(data.form)), `Saved the settings running now to ${p.name}.`);
              }}
            />
          ))}
        </ul>
      </div>

      {activating !== undefined && (
        <ActivateDialog
          profile={activating}
          data={data}
          busy={busy}
          onActivate={() => {
            setActivating(undefined);
            refocus.current = true;
            onActivate(activating);
          }}
          onClose={() => {
            setActivating(undefined);
          }}
        />
      )}
      {sheet !== undefined && (
        <ProfileSheet
          key={sheet.id}
          profile={sheet}
          data={data}
          busy={busy}
          onSave={(f) => {
            setEditing(undefined);
            onApply(updateChanges(sheet, f), `Saved ${sheet.name}. It takes effect when you activate it.`);
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
      {renaming !== undefined && (
        <ProfileNameDialog
          title={`Rename ${renaming.name}`}
          description="Only the name changes; its settings stay as they are."
          action="Rename"
          initial={renaming.name}
          profiles={profiles}
          self={renaming.id}
          busy={busy}
          onSave={(name) => {
            setRenaming(undefined);
            onApply(renameChanges(renaming, name), `Renamed ${renaming.name} to ${name}.`);
          }}
          onClose={() => {
            setRenaming(undefined);
          }}
        />
      )}
      {deleting !== undefined && (
        <DeleteDialog
          profile={deleting}
          busy={busy}
          onDelete={() => {
            setDeleting(undefined);
            refocus.current = true;
            onApply(deleteChanges(deleting), `Deleted ${deleting.name}.`);
          }}
          onClose={() => {
            setDeleting(undefined);
          }}
        />
      )}
      {creating && (
        <ProfileNameDialog
          title="New profile"
          description="It’s saved beside the others and doesn’t change what runs until you activate it."
          action="Create"
          profiles={profiles}
          start={{ live: live !== undefined }}
          busy={busy}
          onSave={(name, from) => {
            setCreating(false);
            if (from === 'live' && live !== undefined) {
              // with nothing active, the copy is what runs: it becomes the active one
              onApply(
                copyLiveChanges(name, formOf(live), data),
                `Saved ${name}, a copy of the settings running now${data.active === undefined ? ', now the active profile' : ''}.`,
              );
              return;
            }
            const id = newProfileId(data);
            // a blank one opens in Edit once it's saved, for its server
            onApply(
              createChanges(name, formOf(blankForm(data)), profiles, pointedId(data)),
              `Saved ${name}. Add its server, then activate it.`,
              () => {
                setEditing(id);
              },
            );
          }}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </Card>
  );
}
