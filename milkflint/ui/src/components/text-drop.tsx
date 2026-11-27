// A key or a file's text, three ways: pasted, a file dropped on the field,
// or a file picked. Dropped or picked files fill the field (several, one
// after another), so what's added is always what's shown first.
import { FileUpIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

async function textOf(files: FileList | null): Promise<string> {
  const texts = await Promise.all([...(files ?? [])].map((f) => f.text()));
  return texts.map((t) => t.trim()).join('\n');
}

export function TextDrop({
  id,
  label,
  value,
  onChange,
  placeholder,
  accept,
  fileLabel,
  invalid = false,
  describedBy,
  actions,
}: {
  id: string;
  /** For screen readers: the field's name. */
  label: string;
  value: string;
  /** The text, and the file's name when it came from a file (the first one's, for several). */
  onChange: (text: string, file?: string) => void;
  placeholder: string;
  /** The file picker's types: ".pub,text/plain". */
  accept: string;
  /** The picker's button: "Open a .pub file". */
  fileLabel: string;
  invalid?: boolean;
  describedBy?: string | undefined;
  /** Beside the picker, at the end of the row: the Add button. */
  actions: ReactNode;
}): ReactElement {
  const [over, setOver] = useState(false);
  const fill = (files: FileList | null): void => {
    const name = files?.[0]?.name;
    void textOf(files).then((t) => {
      if (t !== '') onChange(t, name);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        id={id}
        value={value}
        rows={3}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn('font-mono text-xs break-all placeholder:font-sans', over && 'border-ring bg-primary/5')}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          fill(e.dataTransfer.files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs hover:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
          <FileUpIcon className="size-4" aria-hidden="true" />
          {fileLabel}
          <input
            type="file"
            accept={accept}
            multiple
            className="sr-only"
            onChange={(e) => {
              fill(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <div className="ml-auto flex gap-2">{actions}</div>
      </div>
    </div>
  );
}
