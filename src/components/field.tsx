import { ChevronDown, CircleAlert } from "lucide-react";
import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { cn } from "@/lib/cn";

// Figma "Field" (5:417): the label is always visible; focus = 2 px brand
// border; an error = 2 px danger border, an icon and a message. The helper
// and the error are tied to the control with aria-describedby.

type FieldFrameProps = {
  label: ReactNode;
  helper?: ReactNode;
  error?: string | null;
  className?: string;
};

const boxClass =
  "focus-ring w-full rounded-control border bg-surface px-3.5 text-body text-ink placeholder:text-ink-muted focus:border-brand focus:ring-1 focus:ring-brand focus:ring-inset disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted";

function frame(id: string, error?: string | null, helper?: ReactNode) {
  const describedBy = [
    error ? `${id}-error` : null,
    helper ? `${id}-help` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    border: error
      ? "border-danger ring-1 ring-danger ring-inset"
      : "border-border-strong",
  } as const;
}

function Frame({
  id,
  label,
  helper,
  error,
  className,
  children,
}: FieldFrameProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
      </label>
      {children}
      {error && (
        <p
          id={`${id}-error`}
          className="flex items-center gap-1.5 text-caption text-danger"
        >
          <CircleAlert aria-hidden="true" size={16} className="shrink-0" />
          {error}
        </p>
      )}
      {helper && (
        <p id={`${id}-help`} className="text-caption text-ink-muted">
          {helper}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  helper,
  error,
  className,
  prefix,
  suffix,
  id: givenId,
  ...props
}: FieldFrameProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "prefix"> & {
    prefix?: ReactNode; // shown inside the box, e.g. "Rp"
    suffix?: ReactNode; // e.g. "%"
  }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const { border, ...aria } = frame(id, error, helper);
  return (
    <Frame
      id={id}
      label={label}
      helper={helper}
      error={error}
      className={className}
    >
      <div className="relative">
        {prefix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-body text-ink-muted"
          >
            {prefix}
          </span>
        )}
        <input
          id={id}
          className={cn(
            boxClass,
            border,
            "h-12",
            prefix ? "pl-10" : null,
            suffix ? "pr-10" : null,
          )}
          {...aria}
          {...props}
        />
        {suffix && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-body text-ink-muted"
          >
            {suffix}
          </span>
        )}
      </div>
    </Frame>
  );
}

export function TextAreaField({
  label,
  helper,
  error,
  className,
  id: givenId,
  ...props
}: FieldFrameProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const { border, ...aria } = frame(id, error, helper);
  return (
    <Frame
      id={id}
      label={label}
      helper={helper}
      error={error}
      className={className}
    >
      <textarea
        id={id}
        className={cn(boxClass, border, "min-h-24 resize-y py-3")}
        {...aria}
        {...props}
      />
    </Frame>
  );
}

export function SelectField({
  label,
  helper,
  error,
  className,
  options,
  id: givenId,
  ...props
}: FieldFrameProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children"> & {
    options: readonly { value: string; label: string }[];
  }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const { border, ...aria } = frame(id, error, helper);
  return (
    <Frame
      id={id}
      label={label}
      helper={helper}
      error={error}
      className={className}
    >
      <div className="relative">
        <select
          id={id}
          className={cn(
            boxClass,
            border,
            "h-12 cursor-pointer appearance-none pr-10",
          )}
          {...aria}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={20}
          className="pointer-events-none absolute top-3.5 right-3.5 text-ink"
        />
      </div>
    </Frame>
  );
}
