/** Instant custom tooltip for form hints (native title= is slow). */
export function FormFieldHint({ text }: { text: string }) {
  return (
    <span className="form-field-hint" tabIndex={0} aria-label={text}>
      <span className="form-field-hint__glyph" aria-hidden="true">
        ?
      </span>
      <span className="form-field-hint__popup" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
